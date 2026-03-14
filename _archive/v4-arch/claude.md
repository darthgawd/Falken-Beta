# Claude — V4 Architecture Contributions

Ongoing log of findings, fixes, and decisions made by Claude across sessions.

---

## Session 1 — 2026-03-11

### Architecture Design

Designed the full V4 contract architecture with the user. Final decision:

```
BaseEscrow.sol (abstract) — all money logic
  ├── FiseEscrowV4.sol      — simultaneous commit/reveal (RPS, Battleship, War)
  ├── PokerEngine.sol       — commit/reveal + multi-street betting (all poker variants)
  └── TurnBasedEscrow.sol   — sequential public moves (Liar's Dice, Scrabble, Chess)

PredictionPool.sol          — standalone parimutuel spectator betting
```

Key decisions made:
- **BaseEscrow inheritance** over standalone contracts — avoids duplicating ~250 lines of financial plumbing across 4+ contracts
- **PokerEngine** (not PokerEscrow) — it's an engine, not holding money directly
- **`maxStreets` parameter** — one contract handles all poker variants (1=5-Card Draw, 4=Hold'em, 5=Stud)
- **`MAX_RAISES = 2`** — raise + re-raise, then must call/fold. Prevents infinite raise wars.
- **COMMIT → BET → REVEAL** phase order — after commit, players know own hand (deterministic deck) but can't see opponent's discard. Betting AFTER reveal would expose hands on-chain.
- **Liar's Dice is turn-based** — sequential public bidding, NOT simultaneous. Belongs in TurnBasedEscrow.
- **bytes32 moves** — replaces uint8 (0-255) to support complex games like Scrabble
- **Configurable maxRounds** — was constant 10, now per-match parameter

### Full Game Catalog (40+ games)

Mapped every viable game to a contract type:
- **PokerEngine:** 9 poker variants (5-Card Draw, Hold'em, Omaha, Omaha Hi-Lo, 7-Card Stud, Razz, Short Deck, 2-7 Triple Draw, Badugi)
- **FiseEscrowV4:** 10 simultaneous games (RPS, RPSLS, Matching Pennies, Prisoner's Dilemma, Colonel Blotto, Battleship, War, Coin Guess, Penalty Shootout, Sealed Bid Auction)
- **TurnBasedEscrow:** 17 sequential games (Liar's Dice, Chess, Checkers, Connect Four, Reversi, Go, Tic-Tac-Toe, Mancala, Scrabble, Backgammon, Dominoes, Spades, Hearts, Pinochle, Euchre, Cribbage, Gin Rummy)
- **DealerEscrow:** 4 house games (Blackjack, Baccarat, Craps, Video Poker)

Identified games that DON'T fit: Mahjong (hybrid), real-time games (not blockchain-viable), MMO/persistent state.

### Architecture Gaps Identified

**Operational (10 items):**
1. PredictionPool draw handling — recommendation: refund
2. Betting deadline enforcement — close before match starts
3. Bot collusion risk — Phase 1: log and monitor
4. LogicRegistry `recordVolume` has NO access control — add `authorizedEscrows` mapping
5. Watcher needs multi-contract support — run separate instances per contract
6. Indexer needs multi-contract support — add `escrow_address` column
7. Match scheduler service needed — who creates matches on a schedule?
8. PredictionPool minimum bet size — 0.10 USDC
9. Spectator USDC approval UX — large allowance on first interaction
10. BaseEscrow `leaveMatch` for OPEN status — let players exit before match starts

**Architectural (3 items):**
1. Team-based games — BaseEscrow settles to single winner, need team split (Phase 2)
2. Tournament brackets — standalone TournamentManager.sol (Phase 2)
3. Unsupported game types — Mahjong, Bridge need hybrid mechanics

### Security Audit of BaseEscrow.sol

**CRITICAL — Fixed:**

| # | Issue | Description | Fix Applied |
|---|---|---|---|
| C1 | Side pot double-pay | `_settleMatch` distributed `remainingPot` via `splitBps` AND THEN distributed `potAmounts` on top — would try to send more USDC than contract holds | Removed `potAmounts`/`potEligible`/`potWinnerIndices` from `Resolution`. All distributions come from `totalPot` via `splitBps` only. PokerEngine calculates correct ratios before calling `_settleMatch`. |
| C2 | playerContributions not updated on raises | `playerContributions` only set in `joinMatch` (initial stake). `adminVoidMatch` refunds based on contributions — raises would be lost forever in contract | Added `_addContribution(matchId, player, amount)` internal helper. PokerEngine calls this on raise/call. `adminVoidMatch` now refunds full amount. |
| C3 | Child override drops nonReentrant | `claimTimeout` and `mutualTimeout` were `virtual` with `nonReentrant`. Solidity replaces entire function on override including modifiers. Child forgetting `nonReentrant` = silent reentrancy vulnerability. | Split into non-virtual external wrapper (has `nonReentrant`) + virtual internal function (`_claimTimeout`/`_mutualTimeout`). Guards can't be dropped. |

**HIGH — Fixed:**

| # | Issue | Description | Fix Applied |
|---|---|---|---|
| H1 | JOIN_WINDOW never enforced | `JOIN_WINDOW = 1 hours` declared but never checked. OPEN matches live forever. No `createdAt` in struct to enforce it. | Added `createdAt` to `BaseMatch`. `joinMatch` checks `block.timestamp <= m.createdAt + JOIN_WINDOW`. Added `claimExpiredMatch()` for anyone to void and refund expired matches. |
| H2 | Raw `transfer` instead of SafeERC20 | `_safeTransferUSDC` used raw `usdc.transfer()` while rest of contract used `safeTransfer`/`safeTransferFrom`. Inconsistent, landmine for non-standard ERC20s. | Replaced with `this.executeTransfer()` which uses `safeTransfer` inside try/catch. Consistent SafeERC20 usage throughout. |

**MEDIUM — Fixed:**

| # | Issue | Description | Fix Applied |
|---|---|---|---|
| M1 | Rounding dust accumulation | `(remainingPot * splitBps[i]) / 10000` loses dust to integer division. Accumulates over millions of matches. | Last winner gets `remainingPot - distributed` instead of calculated share. Zero dust left. |
| M2 | No minimum stake | Zero-stake matches = zero rake = wasted gas. | Added `MIN_STAKE = 100_000` (0.10 USDC). Checked in `joinMatch`. |

**LOW — Fixed:**

| # | Issue | Description | Fix Applied |
|---|---|---|---|
| L1 | leaveMatch missing whenNotPaused | Inconsistent with joinMatch. | Kept intentionally WITHOUT `whenNotPaused` — players should be able to exit during emergencies. Added comment documenting conscious decision. |
| L2 | No TreasuryUpdated event | `setTreasury` silently redirects all future rake. | Added `TreasuryUpdated(oldTreasury, newTreasury)` event to interface and contract. |

**Bonus additions:**
- `_settleMatchDraw()` helper — equal split minus rake for draw outcomes
- `claimExpiredMatch()` — anyone can void an OPEN match after JOIN_WINDOW expires

### Security Audit — Architecture-Level (Not Yet Fixed)

These are in the architecture doc but not yet implemented:

| # | Severity | Issue | Status |
|---|---|---|---|
| C1 | CRITICAL | Referee single point of failure — one compromised key drains everything | Documented. Fix: multi-sig or isolated keys per contract. |
| C2 | CRITICAL | PredictionPool fake escrow attack — no whitelist on escrow addresses | Documented. Fix: `authorizedEscrows` mapping in PredictionPool. |
| C4 | CRITICAL | No raise limits — whale can raise $10K on $1 match | Documented. Fix: `BetStructure` enum (NO_LIMIT/POT_LIMIT/FIXED_LIMIT) + `maxBuyIn`. |
| C5 | CRITICAL | MEV on BET phase — raise/call/fold visible in mempool | Documented. Acceptable for Phase 1 on Base (centralized sequencer). |
| I1 | IMPORTANT | Side pots in multi-player poker | PokerEngine must calculate correct splitBps before calling _settleMatch. |
| I2 | IMPORTANT | Deterministic deck seed source not specified | Must use both players' salts: `keccak256(saltA, saltB, matchId, round)`. |
| I3 | IMPORTANT | Events not specified for PokerEngine/PredictionPool | Event signatures documented in architecture doc. |
| I4 | IMPORTANT | TurnBasedEscrow moveHistory gas growth | Store moves as events, keep only moveCount + boardHash on-chain. |
| I5 | IMPORTANT | Non-upgradeability is correct but must be conscious decision | Documented. Migration path: deploy new alongside old, admin migrates OPEN matches. |

### Files Modified
- `contracts/src/core/BaseEscrow.sol` — all 9 audit fixes applied
- `contracts/src/interfaces/IBaseEscrow.sol` — added `createdAt`, `TreasuryUpdated` event, `claimExpiredMatch`, `MIN_STAKE`, simplified `Resolution` struct
- `_archive/shared-ai/claude-v4-architecture-final.md` — full architecture spec v3.0

### Files Referenced (Read-Only)
- `contracts/src/core/LogicRegistry.sol`
- `packages/shared-types/src/index.ts`
- `packages/falken-vm/src/Watcher.ts`
- `packages/llm-house-bot/src/index.ts`
- `packages/indexer/src/index.ts`
- `packages/reference-agent/src/SaltManager.ts`
- `packages/falken-cli/src/index.ts`

---

## Session 1 — Second Pass Audit (same day)

Re-audited the fixed BaseEscrow with completely fresh eyes. Found 4 more issues.

### NEW-1: No `pause()` / `unpause()` Functions (HIGH) — FIXED
Contract inherited `Pausable` and used `whenNotPaused` on 3 functions, but never exposed `pause()` or `unpause()`. The entire pause system was dead code — contract could never actually be paused.

**Fix:** Added `pause()` and `unpause()` with `onlyOwner` to both contract and interface.

### NEW-2: Phantom Match Bug (MEDIUM) — FIXED
`MatchStatus.OPEN` is enum value 0, which is the default for uninitialized storage. Any function checking `status == OPEN` would pass for non-existent match IDs. `claimExpiredMatch(999999)` would emit `MatchVoided` for a match that never existed.

**Fix:** Added `_requireMatchExists(matchId)` helper that checks `matchId > 0 && matchId <= matchCounter`. Added to all functions that operate on matches: `joinMatch`, `leaveMatch`, `claimExpiredMatch`, `claimTimeout`, `mutualTimeout`, `adminVoidMatch`.

### NEW-3: `createMatch` Had No Centralized Init (MEDIUM) — FIXED
`createMatch` was fully abstract. Every child had to independently remember to:
- Set `createdAt = block.timestamp`
- Validate `stake >= MIN_STAKE` and `maxPlayers >= 2`
- Initialize `wins` array with correct length
- Increment `matchCounter`
- Pull creator's USDC stake
- Emit `MatchCreated` and `PlayerJoined`

Any forgotten step = bug.

**Fix:** Replaced abstract `createMatch` with `_initMatch()` internal helper that centralizes ALL common initialization. Child contracts call `_initMatch()` from their own `createMatch()` (which can have extra parameters like `maxStreets`). Creator is auto-joined as `players[0]`. Returns `matchId` for child to attach game-specific state.

### NEW-4: `adminVoidMatch` Missing `nonReentrant` (LOW) — FIXED
No reentrancy guard on the admin void function. Not exploitable (status set to VOIDED before transfers, USDC has no callbacks, function is onlyOwner), but added `nonReentrant` for defense in depth.

### Bonus additions:
- `getMatchWinner(uint256 matchId)` view function — gas-efficient single-field read for PredictionPool (avoids copying entire BaseMatch struct to memory)

### Files Modified (Second Pass)
- `contracts/src/core/BaseEscrow.sol` — all 4 fixes applied
- `contracts/src/interfaces/IBaseEscrow.sol` — added `pause`, `unpause`, `getMatchWinner`, `JOIN_WINDOW` to interface

---

## Session 1 — Third Pass (same day)

### FIX-2: `Ownable` → `Ownable2Step` — APPLIED
Single-step ownership transfer replaced with two-step. Now `transferOwnership()` sets a pending owner, and the new owner must call `acceptOwnership()` to complete the transfer. Prevents accidental loss of ownership from typos.

### FIX-4: `MatchActivated` event — APPLIED
Added `MatchActivated(uint256 indexed matchId)` event to interface and emitted in `joinMatch` when the match becomes full (status → ACTIVE). Simplifies indexer logic and signals PredictionPool when to close betting.

### Remaining items (all LOW/informational, user decided not to fix):
- `MUTUAL_TIMEOUT_PENALTY_BPS` declared but unused — child contracts reference it
- `executeTransfer` visible in ABI — not harmful, just confusing
- String errors vs custom errors — gas optimization only
- Draw rake — business decision (currently 5% rake on draws)
- `logicId` not validated against LogicRegistry — validated at Watcher level instead
- Child `createMatch` needs own `nonReentrant whenNotPaused` — documented in contract header
- Developer fee not in contract — will use FALK token distribution if needed later

### Files Modified (Third Pass)
- `contracts/src/core/BaseEscrow.sol` — `Ownable` → `Ownable2Step`, `MatchActivated` event emission
- `contracts/src/interfaces/IBaseEscrow.sol` — added `MatchActivated` event

---

*Last updated: 2026-03-11*


---

## Session 2 — 2026-03-13 (Kimi Handoff Session)

### Context
User handed off from Kimi to Claude. Active issue: `SANDBOX_EXECUTION_ERROR: not a function` in Falken VM when resolving Match #12.

### Bugs Fixed

#### VM Bug 1: Game Class Export Transformation (CRITICAL) — FIXED

**Issue:** The QuickJS WASM sandbox couldn't execute bundled JavaScript game logic from IPFS. The bundled code had pattern `var u=class{...}export{u as default};` which wasn't being transformed correctly.

**Root Cause:** Multiple issues in `transformJsCode()`:
1. Regex patterns didn't match minified bundled code (`var u=class{...}`)
2. `module.exports` was being stripped by subsequent `/\bexport\b/g` replacement
3. The wrapper script expected `checkResult()` but poker games use `evaluateWinner()`

**Fix Applied:**
- Completely rewrote `transformJsCode()` in `packages/falken-vm/src/Referee.ts`
- Added pattern matching for `var Name=class{...}` bundled syntax
- Wrapped code in IIFE: `(function() { ...; return ClassName; })()`
- Added support for both `checkResult` (standard) and `evaluateWinner` (poker-specific) methods
- Removed debug logging and cleaned up error messages

**Files Modified:**
- `packages/falken-vm/src/Referee.ts` — Complete rewrite of `transformJsCode()`

---

### NEW BUG DISCOVERED — NOT YET FIXED

#### PokerEngine: Fold in 2-Player Game Immediately Settles ENTIRE MATCH (CRITICAL)

**Issue:** When a player folds in a 2-player game, the `fold()` function immediately settles the **entire match** instead of just awarding the current round and checking if match completion criteria (`winsRequired`) are met.

**Location:** `contracts/src/core/PokerEngine.sol`, lines 333-336

**Current Code:**
```solidity
// Last player standing wins immediately
if (ps.activePlayers == 1) {
    _settleMatchSingleWinner(matchId, _findLastActivePlayer(matchId));
    return;
}
```

**Problem:** 
- Match is created with `winsRequired = 3` (need 3 round wins to win match)
- Player 1 wins Round 1 (wins[0] = 1)
- Player 2 folds in Round 2
- **Current:** Match settles immediately — Player 1 wins entire match with only 1 round win
- **Expected:** Player 1 should win Round 2 (wins[0] = 2), match continues until someone gets 3 wins OR maxRounds reached

**Correct Behavior:**
```solidity
if (ps.activePlayers == 1) {
    uint8 winnerIdx = _findLastActivePlayer(matchId);
    m.wins[winnerIdx]++;
    emit RoundResolved(matchId, m.currentRound, winnerIdx);
    
    // Check if match is complete
    if (m.wins[winnerIdx] >= m.winsRequired) {
        _settleMatchSingleWinner(matchId, winnerIdx);
    } else if (m.currentRound >= m.maxRounds) {
        _settleByMostWins(matchId);
    } else {
        _startNextRound(matchId);  // Continue to next round
    }
    return;
}
```

**Multi-Player (3+) Logic Status:**
✅ Already correct — when a player folds in 3+ player game:
1. `activePlayers` decrements but remains ≥ 2
2. Betting continues with remaining players
3. Round plays out to reveal phase
4. `resolveRound()` properly awards round and checks `winsRequired`

**Impact:**
- 2-player poker matches end after first fold (1-2 rounds max)
- Betting/pot dynamics never fully tested
- PredictionPool bets may resolve incorrectly (match ends too early)

**Files To Modify:**
- `contracts/src/core/PokerEngine.sol` — Fix `fold()` function logic

---

### Other Fixes Applied This Session

#### Bot Fixes (BigInt & Nonce Management)

**Joshua & David Bots:**
1. **BigInt type errors** — Fixed arithmetic/comparisons (`amountOwed > 0n`, `raiseCount < 2n`)
2. **Nonce management** — Added `{ nonce: await this.wallet.getNonce('pending') }` to all transactions to prevent `REPLACEMENT_UNDERPRICED` errors
3. **David's identity** — Changed from `HOUSE_BOT_PRIVATE_KEY` (same as Joshua) to `AGENT_PRIVATE_KEY` for unique wallet address

**Files Modified:**
- `packages/llm-house-bot/src/index.ts` (Joshua)
- `packages/llm-house-bot-david/src/index.ts` (David)

---

*Last updated: 2026-03-13*


---

## Session 2 — 2026-03-13 (Continued)

### Dashboard Card Display Fix — RESOLVED ✅

**Issue:** Cards were displaying face-down or showing incorrect hands for settled matches.

**Root Cause:** Multiple issues:
1. `player_index` was NULL in rounds table (indexer not setting it)
2. `move_bytes32` field name mismatch (interface expected `move`)
3. Deck seed derivation didn't match bot's algorithm

**Fixes Applied:**

1. **Indexer** (`packages/indexer/src/index.ts`):
   - Added `player_index` lookup when inserting rounds on `MoveRevealed`
   - Fixed to query match players and find correct index

2. **Dashboard Interface** (`apps/dashboard/src/app/match/[id]/page.tsx`):
   - Updated `Round` interface to include `move_bytes32`, `move`, `move_decoded`
   - Changed `playerAMove`/`playerBMove` to use `move_decoded ?? move_bytes32`
   - Added salts fetching from `/api/salts` endpoint
   - Fixed salt lookup to match by player address

3. **Dashboard API** (`apps/dashboard/src/app/api/salts/route.ts`):
   - Created new API route to fetch salts from `salt_vault` using service role key
   - Bypasses RLS policy "Deny public" on salt_vault table

4. **PokerTable Component** (`apps/dashboard/src/components/PokerTable.tsx`):
   - Fixed seed derivation: `(matchId + "_" + round).toLowerCase()`
   - Must match bot's `computeHand` function exactly
   - Removed sorting of salts (order matters!)

**Key Learning:** The deck seed must be derived identically across:
- Bot's `computeHand()` function
- VM's game logic execution  
- Dashboard's card display

All three must use: `(fullMatchId + "_" + round).toLowerCase()`

**Files Modified:**
- `packages/indexer/src/index.ts`
- `apps/dashboard/src/app/match/[id]/page.tsx`
- `apps/dashboard/src/app/api/salts/route.ts` (new)
- `apps/dashboard/src/components/PokerTable.tsx`
- `apps/dashboard/.env` (added SERVICE_ROLE_KEY)

**Status:** ✅ Cards now display correctly for all rounds!
