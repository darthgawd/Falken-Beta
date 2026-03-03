# Falken Protocol: Commit-Reveal & Battle Log Troubleshooting

## 1. Objective
To implement a robust on-chain commit-reveal gameplay loop where:
1.  **Strategic Secrecy:** Moves (Rock, Paper, Scissors) remain hidden until *both* players have revealed.
2.  **Simultaneous Display:** Both moves appear in the Battle Log at the exact same time once the round is resolved.
3.  **Score Integrity:** Win counts (`wins_a`, `wins_b`) are accurate and never double-counted.
4.  **UI Stability:** The Battle Log and match phase indicators remain visible and stable during all state transitions.

---

## 2. Current Status (Branch: `reveal-commit`)
- **Simultaneous Reveal:** IMPLEMENTED. The "Dual-Reveal Gate" pattern is live in the Indexer. Moves are hidden until both players reveal.
- **Win Counts:** FIXED. Uses `syncMatchScore` to calculate totals from round history instead of simple increments.
- **Joshua (House Bot):** FIXED. ABI and Hashing logic are aligned with the contract. He is limited to 1 game at a time.
- **Schema:** `hidden_move` (INTEGER) column exists on the `rounds` table in Supabase (`supabase/08_hidden_moves.sql`).
- **UI:** Updated to handle `revealed: true, move: null` state with a pulsing yellow "REVEALED" badge.

### ACTIVE BUG: Round 1 Row Disappears (Fix Applied — Needs Testing)
- **Symptom:** Round 1 displays correctly at first (both moves show simultaneously as intended), but then the entire Round 1 row **vanishes** from the Battle Log. All subsequent rounds (2, 3, etc.) display and persist correctly.
- **Root Cause (Dual):**
  1. **UI Realtime Race Condition:** When round 1 resolves, the Indexer rapidly processes `MoveRevealed`, `RoundResolved`, and `RoundStarted` — each writing to Supabase. Each write fires a Realtime notification, triggering `fetchData()`. With no sequencing, 5-6 overlapping fetches race. If an early fetch (with stale/incomplete data) completes AFTER a later fetch (with correct data), it overwrites the UI state, causing Round 1 to vanish.
  2. **Unguarded `RoundStarted` DELETE:** The handler blindly deleted all round entries for `args.roundNumber`. While intended for sudden-death replays, this is a risk if event ordering or data is ever unexpected.
- **Fixes Applied:**
  1. **Fetch sequence counter** in `page.tsx`: Each `fetchData()` call gets an incrementing sequence number. When the response arrives, it checks if a newer fetch was started — if so, it discards its results. Only the latest fetch updates state.
  2. **Guarded delete** in Indexer `RoundStarted` handler: Now checks if existing round entries have `winner = 0` (draw) before deleting. Normal round progression (no existing data for the new round number) skips the delete entirely.

---

## 3. Technical Specs (The "Ground Truth")

### On-Chain Match Struct
The `Match` struct in `MatchEscrow.sol` has 12 fields. The Indexer and Bots **MUST** include `drawCounter` to avoid a decoding shift:
```solidity
struct Match {
    address playerA;
    address playerB;
    uint256 stake;
    address gameLogic;
    uint8 winsA;
    uint8 winsB;
    uint8 currentRound;
    uint8 drawCounter; // CRITICAL: This was missing in earlier ABIs
    Phase phase;
    MatchStatus status;
    uint256 commitDeadline;
    uint256 revealDeadline;
}
```

### Cryptographic Hash Formula
The contract requires this exact format for `commitMove`:
`keccak256(abi.encodePacked("FALKEN_V1", escrowAddress, matchId, round, playerAddress, move, salt))`

### On-Chain Event Emission Order (from `MatchEscrow.sol`)
Understanding this is critical for the Indexer:
1. `joinMatch()` → emits `MatchJoined` then `RoundStarted(round=1)`
2. `commitMove()` → emits `MoveCommitted` (phase flips to REVEAL after both commit)
3. `revealMove()` → emits `MoveRevealed`. When BOTH reveals are in, calls `_resolveRound()` in the SAME transaction.
4. `_resolveRound()`:
   - Emits `RoundResolved(winner)`
   - If **draw** (winner=0, drawCounter < 3): emits `RoundStarted(SAME round number)` — sudden death replay
   - If **win** and match continues: increments `currentRound`, emits `RoundStarted(NEXT round number)`
   - If **match over**: calls `_settleMatch()` → emits `MatchSettled`

**Key insight:** The second `MoveRevealed`, `RoundResolved`, and `RoundStarted` all fire in the SAME transaction/block. The Indexer processes them sequentially from the same log batch.

---

## 4. History of Attempted Fixes & Outcomes

### Phase 1: The "Decoding Shift" (Fixed)
- **Problem:** Joshua and SimpleAgent wouldn't move. They saw matches as `OPEN` even when they were `ACTIVE`.
- **Cause:** The ABI was missing `drawCounter`. When the contract returned `phase: 0` (COMMIT), the bot read it into the `status` slot. Since `status: 0` is `OPEN`, the bot thought the match hadn't started yet.
- **Fix:** Updated `ESCROW_ABI` in all bots and scripts to include `drawCounter`.

### Phase 2: Simultaneous Reveal — First Attempt (Failed/Rolled Back)
- **Goal:** Hide the image of Player A's move if they reveal before Player B.
- **Attempt:**
    1. Added `hidden_move` column to Supabase.
    2. Modified Indexer `MoveRevealed` to write the move to `hidden_move` while leaving the public `move` column `NULL`.
    3. Modified Indexer `RoundResolved` to copy `hidden_move` -> `move` for both players.
- **Outcome:** **FAILURE.** The Battle Log table often disappeared or showed "WAITING" even after both players moved.
- **Diagnosis:**
    - Race condition: `RoundResolved` sometimes fired before the second `MoveRevealed` had finished writing to `hidden_move`.
    - `upsert` issues: In the Indexer, using `upsert` with partial data was occasionally overwriting existing fields (like `commit_hash`) with `null`.

### Phase 3: Simultaneous Reveal — "Dual-Reveal Gate" (Current — Mostly Working)
- **Goal:** Same as Phase 2, but fix the race condition and upsert issues.
- **Implementation (in `packages/indexer/src/index.ts`):**
    1. `MoveRevealed` handler now uses `.update().match()` (NOT `upsert`) to write the move to `hidden_move` and set `revealed: true`. This preserves `commit_hash`.
    2. If the update hits 0 rows (edge case: missed `MoveCommitted`), falls back to `upsert` with only the necessary fields.
    3. **Dual-Reveal Gate:** After writing, queries: "Are there now 2 rows with `revealed: true` AND `hidden_move IS NOT NULL` for this match+round?" If YES → copies `hidden_move` → `move` for BOTH players. If NO → does nothing, move stays hidden.
    4. `RoundResolved` handler has a **safety net**: before writing the winner, it checks for any rows where `hidden_move` is set but `move` is still null, and copies them over.
- **UI changes (`apps/dashboard/src/app/match/[id]/page.tsx`):**
    - New state: `revealed: true` + `move == null` → shows pulsing yellow "REVEALED" badge
    - `revealed: true` + `move != null` → shows the move icon (ROCK/PAPER/SCISSORS)
    - The condition changed from `round.a?.revealed` to `round.a?.revealed && round.a?.move != null` for showing moves.
- **Outcome:** **MOSTLY WORKING.** Simultaneous reveal works. Rounds 2+ display perfectly. **Round 1 disappears** from the Battle Log shortly after resolving (see ACTIVE BUG above).

### Phase 4: Score Inflation / Double Wins (Fixed)
- **Problem:** A single round win resulted in the UI showing "2 Rounds Won."
- **Cause:**
    1. Multiple Indexer processes were likely running.
    2. The Indexer was incrementing wins in `RoundResolved` AND `MatchSettled`.
    3. `ensureMatchExists` (the self-healing logic) was overwriting local state with cumulative contract state.
- **Fix:**
    1. Implemented `syncMatchScore(dbMId)`.
    2. Instead of `wins = wins + 1`, it now does: `SELECT count(*) FROM rounds WHERE winner = 1`.
    3. This "Source of Truth" approach makes double-counting mathematically impossible.

### Phase 5: UI Stability (Fixed)
- **Problem:** The Battle Log table would vanish during the transition from Round 1 to Round 2.
- **Cause:** The `groupedRounds` logic in `page.tsx` was fragile. If a round entry was partially missing or the Indexer was mid-cleanup, the `reduce` function would fail or return an empty object.
- **Fix:** Hardened the grouping logic in `apps/dashboard/src/app/match/[id]/page.tsx` to handle `null` values and ensure the table always renders based on available history.

---

## 5. Score Incrementing +2 Instead of +1 (FIXED)

### Observed in Match #29 (0x6a00e6bcd567518c6e0a586dd12c3f8abb646482-29)
- **Symptom:** Player A (Joshua) won Round 1 (Rock vs Scissors), but the "Rounds Won" column showed **2** instead of **1**. The Battle Log itself was correct — only the score/win count was wrong.
- **Root Cause:** `RoundResolved` handler sets `winner` on ALL rows for that round via `.match({ match_id, round_number })`, which hits BOTH player rows. Then `syncMatchScore` counted all rows with `winner === 1`, getting 2 instead of 1 (one per player row).
- **Fix (Branch: `increment/reveal-commit`):** Changed `syncMatchScore` to filter by `.eq('player_index', 1)`, so it only counts Player A's row per round as the canonical source. The `winner` value on that row is still correct regardless of who won (1 = A won, 2 = B won), so both players' scores are accurate. Each round is now counted exactly once.
- **Status:** FIXED and verified in live testing.

---

## 6. Previous Mission: Verify Round 1 Fix

The Round 1 disappearance fix has been applied (fetch sequencing + guarded delete). **Needs live testing.**

### If Round 1 STILL disappears after these fixes:
1. **Check Supabase directly:** `SELECT * FROM rounds WHERE match_id = '<id>' AND round_number = 1` — if data is gone, the Indexer is still deleting it somehow. If data is present with valid `move` values, the UI is still dropping it.
2. **Add console logging** to the `fetchData` function to see what `roundsData` contains on each fetch.
3. **Check if the `groupedRounds` reduce** is silently dropping a round due to a `null` or unexpected `player_index`.

### Constraints (DO NOT BREAK)
- The `hidden_move` → `move` copy logic is working. Do not revert to direct writes.
- The `.update().match()` pattern in `MoveRevealed` is protecting `commit_hash`. Do not switch back to `upsert`.
- The `syncMatchScore` approach in `RoundResolved` is preventing double-counting. It filters by `player_index=1` to count one row per round. Do not change.
- The fetch sequence counter in `page.tsx` prevents stale Realtime responses from overwriting newer data. Do not remove.
- Sudden death cleanup (`DELETE` in `RoundStarted`) now only fires when `winner = 0` (draw replay). Do not revert to unguarded delete.

### Key Files
- **Indexer:** `packages/indexer/src/index.ts` (all event handlers)
- **UI:** `apps/dashboard/src/app/match/[id]/page.tsx` (Battle Log rendering + fetch sequencing)
- **Contract:** `contracts/src/core/MatchEscrow.sol` (event emission order)
- **Schema:** `supabase/00_master_setup.sql` (rounds table PK: `match_id, round_number, player_address`)
- **Migration:** `supabase/08_hidden_moves.sql` (adds `hidden_move` column)
