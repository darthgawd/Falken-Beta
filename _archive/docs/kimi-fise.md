# PROJECT FALKEN: FISE Complete Implementation Guide

## Overview

FISE (Falken Immutable Scripting Engine) allows JavaScript-based games to be played on-chain. This document provides the complete implementation guide including all fixes, contract changes, and deployment steps.

**Last Updated**: 2026-02-28
**Status**: ✅ OPERATIONAL (multi-round) | ✅ Poker Blitz logic verified | 🔴 CRITICAL BUG: Joshua not revealing rounds 2+

---

## Current Testnet Deployment (Base Sepolia)

| Contract | Address | Status |
|----------|---------|--------|
| **FiseEscrow** | `0x8e8048213960b8a1126cB56FaF8085DccE35DAc0` | ✅ Live (multi-round) |
| **Logic Registry** | `0xc87d466e9F2240b1d7caB99431D1C80a608268Df` | ✅ Live |
| **Price Provider** | `0xFd2f3194b866DbE7115447B6b79C0972CcEDE3Ca` | ✅ Live |
| **RPS Logic ID** | `0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3` | ✅ Registered |
| **Poker Blitz Logic ID** | `0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4` | ✅ Registered |
| **Poker IPFS CID** | `QmYX1y7mASoDr9sL8t7P1e1FE4ZKjLYJ65UXh7VLbTMvR6` | ✅ Pinned |
| **Liar's Dice Logic ID** | `0x2376a7b3448a3b64858d5fcfeca172b49521df5ce706244b0300fdfe653fa28f` | ✅ Registered |

**Bot Wallets**:
- **HouseBot (Joshua)**: `0xb63Ec09E541bC2eF1Bf2bB4212fc54a6Dac0C5f4`
- **SimpleAgent**: `0xAc4E9F0D2d5998cC6F05dDB1BD57096Db5dBc64A`
- **Referee**: `0xCfF9cEA16c4731B6C8e203FB83FbbfbB16A2DFF2`

---

## 🔴 CRITICAL OPEN BUG: Joshua Not Revealing (Rounds 2+)

### Symptom
Joshua (LLM House Bot) successfully commits and reveals for **round 1** of every Poker Blitz match, but **never reveals for rounds 2, 3, etc.** The match stalls. On the dashboard, rounds 2+ show "NO ACTION" for Joshua.

### What We Know

1. **Round 1 works perfectly**: Both bots commit, both reveal, Watcher settles, contract advances to round 2.
2. **Round 2+**: Joshua commits successfully (logs show `🎲 LLM committing move`), but never enters the reveal branch (`phase === 1 && !revealed`).
3. **The Watcher appears to settle rounds before Joshua gets a chance to reveal.** The Watcher resolves round 2 using... something... before Joshua's next 30-second poll cycle.

### Root Cause Investigation So Far

We investigated and fixed several potential causes. None fully resolved the issue:

#### Theory 1: Reconstructor Fetching Stale Data ✅ FIXED (but didn't solve it)
**Problem**: Reconstructor was fetching ALL rounds from the DB, not just the current round. This caused the Referee to re-process round 1's data when resolving round 2.
**Fix applied** (`packages/falken-vm/src/Reconstructor.ts`): Now filters by `match.current_round`:
```typescript
const currentRound = match.current_round || 1;
const { data: rounds } = await this.supabase
  .from('rounds')
  .select('*')
  .eq('match_id', matchId)
  .eq('round_number', currentRound)  // <-- CRITICAL: only current round
  .order('player_index', { ascending: true });
```

#### Theory 2: Processing Lock Dropping Events ✅ FIXED (but didn't solve it)
**Problem**: After settling round 1, the Watcher held a 30-second processing lock on the matchId. Any MoveRevealed events for round 2 arriving during that window were silently dropped (the lock check just returned). After the lock expired, no new triggers arrived.
**Fix applied** (`packages/falken-vm/src/Watcher.ts`):
- Events arriving during lock are now **queued** in `pendingRetries` Map
- When lock expires (reduced to 10s), queued matches are automatically reprocessed
```typescript
private pendingRetries = new Map<string, { escrow: `0x${string}`, registry: `0x${string}` }>();

// In processMatch:
if (this.processingLocks.has(dbMatchId)) {
  this.pendingRetries.set(dbMatchId, { escrow: escrowAddress, registry: registryAddress });
  return;
}

// After settlement success:
setTimeout(() => {
  this.processingLocks.delete(dbMatchId);
  const pending = this.pendingRetries.get(dbMatchId);
  if (pending) {
    this.pendingRetries.delete(dbMatchId);
    this.processMatch(dbMatchId, pending.escrow, pending.registry);
  }
}, 10_000);
```

#### Theory 3: Watcher Running Old Code
User starts Watcher with `pnpm -F @falken/vm build && pnpm -F @falken/vm start`. They confirmed rebuilding and restarting. But the bug persists.

### What Needs Investigation

1. **Is the Watcher actually processing round 2 events?** Add more logging to see exactly what's happening when round 2 starts. The Watcher's `processMatch` should log whether it's being called at all for round 2, and what `current_round` the Reconstructor returns.

2. **Is `current_round` being updated in the DB?** After the Watcher settles round 1, the contract emits `RoundStarted(matchId, 2)`. The indexer handles this and updates `current_round = 2` in the matches table. Verify this is happening. SQL: `SELECT match_id, current_round, phase FROM matches WHERE match_id LIKE '%<matchId>';`

3. **Is the Watcher's LOGIC_PENDING path interfering?** When the Referee returns `null` (pending), the Watcher submits Draw(0) to the contract. This resets phase to COMMIT. For Poker, the Referee should always return a definitive result (1, 2, or 0) when it has 2 moves — it should never return `null`. But check if somehow only 1 move is being passed and the Referee returns `null`, causing an unwanted draw settlement.

4. **Timing**: Joshua polls every 30 seconds. The SimpleAgent polls every 20 seconds. If the Watcher settles too fast (before Joshua even commits for round 2), Joshua might see the match already advanced to round 3 or settled.

5. **Joshua's poll loop**: In `llm-house-bot`, after committing, Joshua waits 30 seconds before polling again. During that time:
   - The Agent may also commit
   - The contract may move to REVEAL phase
   - Joshua needs to poll again to see phase=1 and reveal
   - But the Watcher may have already settled with stale or incomplete data

### Key Debugging Steps for Kimi

1. **Add extensive logging to Watcher.processMatch()**:
   - Log `current_round` from the Reconstructor
   - Log the exact moves being passed to the Referee
   - Log the Referee's return value
   - Log whether this is a fresh call or a queued retry

2. **Check the on-chain state directly**: After round 1 settles, query the contract to see what round/phase it's in:
   ```bash
   cast call $ESCROW_ADDRESS "getMatch(uint256)" <matchId> --rpc-url $RPC_URL
   ```

3. **Reduce Joshua's poll interval**: Change from 30s to 10s in `packages/llm-house-bot/src/index.ts` line 77. This gives Joshua more chances to catch the REVEAL phase before the Watcher does something.

4. **Check if the Referee is returning null for single-move poker**: The Referee gets moves from the Reconstructor. If only 1 move is unmasked (dual-reveal gate issue), the poker logic processes 1 move → `checkResult()` returns 0 (pending) → Referee returns `null` → Watcher settles as Draw(0) → contract resets phase → round replays or advances prematurely.

5. **Verify dual-reveal gate timing**: The indexer unmasks `hidden_move → move` only when BOTH players have revealed. But the Watcher's blockchain listener fires on each MoveRevealed. If the first reveal triggers the Watcher before the indexer processes the second reveal's dual-reveal gate, the Reconstructor gets 0 unmasked moves → bails. Then the second reveal triggers the Watcher, but the lock may still be active.

---

## All Fixes Applied in This Session (2026-02-28, Claude Session)

### Fix 11: Reconstructor Current-Round Filter ✅
**Problem**: Reconstructor fetched ALL rounds, causing Referee to use stale round 1 data for round 2+.
**File**: `packages/falken-vm/src/Reconstructor.ts`
**Fix**: Filter by `match.current_round` (see code above).

### Fix 12: Watcher Event Queue ✅
**Problem**: Processing lock dropped MoveRevealed events for round 2+ during the 30-second hold.
**File**: `packages/falken-vm/src/Watcher.ts`
**Fix**: Added `pendingRetries` Map, reduced lock to 10 seconds, auto-reprocess on unlock (see code above).

### Fix 13: Watcher Dual-Reveal Bail ✅
**Problem**: Watcher threw RECONSTRUCTION_FAILED when no unmasked moves existed (first reveal, dual-reveal gate hasn't unmasked yet).
**File**: `packages/falken-vm/src/Watcher.ts`
**Fix**: `getSyncedMoves()` returns empty array instead of throwing. `processMatch()` bails early with lock release when `moves.length === 0`.

### Fix 14: Duplicate Settlement Prevention ✅
**Problem**: Blockchain event + Supabase realtime listener both triggered settlement for the same round, causing nonce errors.
**File**: `packages/falken-vm/src/Watcher.ts`
**Fix**: Processing lock held after successful settlement (instead of `finally` block releasing immediately). Reduced from 30s to 10s.

### Fix 15: Salt Extraction from Transaction Calldata ✅
**Problem**: Dashboard showed DISCARD actions but not actual poker hands. MoveRevealed event doesn't include salt. Without salt, `PokerHand` component can't compute hands via `generateDeck(player + salt)`.
**File**: `packages/indexer/src/index.ts`
**Fix**: In MoveRevealed handler, fetch the reveal transaction, decode calldata with `decodeFunctionData`, extract salt from 3rd argument of `revealMove(matchId, move, salt)`:
```typescript
import { decodeFunctionData } from 'viem';
// Added revealMove function ABI to ESCROW_ABI array
let salt: string | null = null;
try {
  const tx = await publicClient.getTransaction({ hash: log.transactionHash });
  const decoded = decodeFunctionData({ abi: ESCROW_ABI, data: tx.input });
  if (decoded.functionName === 'revealMove' && decoded.args) {
    salt = decoded.args[2] as string;
  }
} catch (err: any) {
  logger.warn({ matchId: mId, err: err.message }, 'Failed to extract salt from tx calldata');
}
// Salt spread into both update and upsert calls: ...(salt ? { salt } : {})
```

### Fix 16: Joshua Salt Reuse on Commit Retry ✅
**Problem**: When Joshua's commit TX failed/timed out, next poll generated a new salt → different poker hand → committed with new salt → but SaltManager still had old salt → reveal failed with hash mismatch.
**File**: `packages/llm-house-bot/src/index.ts`
**Fix**: Before generating a new salt, check SaltManager for an existing entry for this match+round. If found, reuse it:
```typescript
if (phase === 0 && commitHash === ethers.ZeroHash) {
  const existing = await this.saltManager.getSalt(dbMatchId, round);
  if (existing) {
    // Reuse saved salt — recompute hash and retry commit
    const hash = ethers.solidityPackedKeccak256(...);
    await this.escrow.commitMove(matchId, hash);
    return;
  }
  // No existing salt — generate fresh
  const salt = ethers.hexlify(ethers.randomBytes(32));
  // ...
}
```

### Fix 17: Poker Hand Computation for Bots ✅
**Problem**: Both bots made random/uninformed discards — they didn't know what cards they had.
**Files**: `packages/llm-house-bot/src/index.ts`, `packages/reference-agent/src/SimpleAgent.ts`
**Fix**:
1. Salt generated BEFORE calling `getLLMMove()` (was after)
2. Added `computePokerHand(address, salt)` — mirrors `poker.js` `generateDeck()`:
```typescript
private computePokerHand(address: string, salt: string): number[] {
  const seedStr = address.toLowerCase() + salt;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const deck = Array.from({length: 52}, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    hash = (Math.imul(1664525, hash) + 1013904223) | 0;
    const j = Math.abs(hash % (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 5);
}
```
3. Added `cardName(card)` to convert card number (0-51) to readable format
4. LLM prompt now includes actual hand with card names and indices

### Fix 18: uint8 Overflow Clamping ✅
**Problem**: Poker discard move "430" = 430 exceeds uint8 max (255). Contract rejects with "value out-of-bounds".
**Files**: `packages/llm-house-bot/src/index.ts`, `packages/reference-agent/src/SimpleAgent.ts`
**Fix**:
- Prompts limit discards to max 2 cards
- Code clamps: if move > 255, sort digits descending and keep top 2:
```typescript
if (move > 255) {
  const digits = String(json.move).split('').map(Number).sort((a, b) => b - a);
  move = Number(digits.slice(0, 2).join(''));
}
```

### Fix 19: Leading Zero Encoding ✅
**Problem**: `Number("03")` = 3, losing index 0. Poker discard "03" (indices 0,3) becomes 3 (just index 3).
**Files**: `packages/llm-house-bot/src/index.ts`, `packages/reference-agent/src/SimpleAgent.ts`
**Fix**: Prompts instruct LLMs to list indices in DESCENDING order. "03" → "30" = 30 preserves both indices.

---

## Which Bot Package is Joshua?

**IMPORTANT**: There are TWO house bot packages:
1. `packages/house-bot` — the original HouseBot (NOT currently used)
2. `packages/llm-house-bot` — the LLM-powered House Bot (**THIS IS JOSHUA**)

The user runs Joshua as: `pnpm -F llm-house-bot start` (or `cd packages/llm-house-bot && pnpm start`)
The user runs the Watcher as: `pnpm -F @falken/vm build && pnpm -F @falken/vm start`

Both packages received the poker hand computation fixes, but `llm-house-bot` is the one that matters for live testing.

---

## Poker Blitz: Move Encoding

| Move | Meaning |
|------|---------|
| `0` | Keep all cards |
| `4` | Discard card at index 4 |
| `42` | Discard cards at indices 4 and 2 |
| `43` | Discard cards at indices 4 and 3 |
| `210` | Discard cards at indices 2, 1, 0 (but 210 fits in uint8) |
| `430` | Discard indices 4, 3, 0 — **EXCEEDS uint8!** |

**Rule**: Max 2 discards to stay within uint8. Indices listed in DESCENDING order to avoid leading zeros.

---

## Recent Fixes Applied (2026-02-28, Kimi Session)

### Fix 6: Indexer MatchSettled ABI Mismatch ✅

**Problem**: `parseEventLogs` silently dropped all `MatchSettled` events because the ABI declared `winner` as `indexed: true` but the actual contract emits it as non-indexed data (in `data` field, not `topics`). Result: matches showed ACTIVE in Supabase even though they were SETTLED on-chain.

**File**: `packages/indexer/src/index.ts`

**Solution**: Changed `winner` from `indexed: true` to `indexed: false`:
```typescript
// BEFORE (wrong - expected 3 topics but event only has 2):
{ name: 'MatchSettled', inputs: [
  { name: 'matchId', indexed: true },
  { name: 'winner', indexed: true },    // WRONG
  { name: 'payout', indexed: false }
]}

// AFTER (correct - matches on-chain event signature):
{ name: 'MatchSettled', inputs: [
  { name: 'matchId', indexed: true },
  { name: 'winner', indexed: false },   // FIXED
  { name: 'payout', indexed: false }
]}
```

### Fix 7: Dashboard FISE Badge ✅

**Problem**: Match detail page showed "??" badge for FISE matches (only checked RPS/DICE addresses).

**File**: `apps/dashboard/src/app/match/[id]/page.tsx`

**Solution**: Added FISE detection via `is_fise` flag or escrow address sentinel:
```typescript
const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || '').toLowerCase();

// In badge rendering:
match.is_fise || (match.game_logic?.toLowerCase() === ESCROW_ADDRESS && ESCROW_ADDRESS)
  ? 'FISE' : '??'
// Styled with cyan: bg-cyan-500/10 text-cyan-500 border-cyan-500/20
```

### Fix 8: FISE Round Winner Back-Propagation ✅

**Problem**: FISE `RoundResolved` event fires with `winner=0` (off-chain resolution), so battle log showed "DRAW" even when there was a winner.

**File**: `packages/indexer/src/index.ts` (MatchSettled handler)

**Solution**: After settling, back-propagate the match winner to rounds and re-sync score:
```typescript
// In MatchSettled handler, after computing winnerIndex:
const { data: matchCheck } = await supabase.from('matches').select('is_fise').eq('match_id', mId).single();
if (matchCheck?.is_fise) {
  await supabase.from('rounds').update({ winner: winnerIndex }).eq('match_id', mId);
  await syncMatchScore(mId!); // Re-sync wins_a/wins_b
}
```

### Fix 9: Indexer Backfill Chunk Size ✅

**Problem**: `BACKFILL_CHUNK = 10n` crawled through empty blocks at 10 blocks/batch, taking forever to reach settlement events.

**File**: `packages/indexer/src/index.ts`

**Solution**: Increased to `BACKFILL_CHUNK = 2000n`. Alchemy free tier handles `getLogs` over 2000-block ranges fine.

### Fix 10: HouseBot Multiple Match Creation ✅

**Problem**: Joshua only tracked OPEN and WAITING matches. If an opponent joined and they were mid-game (ACTIVE with real opponent), Joshua would create another match.

**File**: `packages/house-bot/src/HouseBot.ts`

**Solution**: Added `activeByLogic` tracking — won't create new match while playing:
```typescript
const activeByLogic: Record<string, boolean> = {};

if (s === 1 && (isPlayerA || isPlayerB) && !playerBIsEmpty) {
  activeByLogic[logic] = true;
}

// Gate creation on all three states
if (openByLogic[logicLower]) { /* skip */ }
else if (waitingMatchesByLogic[logicLower]) { /* skip */ }
else if (activeByLogic[logicLower]) { /* skip - playing */ }
else { await this.createLiquidity(logic); }
```

---

## ✅ COMPLETED: Multi-Round FISE Implementation (2026-02-28)

### Overview
Multi-round FISE support has been implemented. Matches now play best-of-5 (first to 3 wins) with draws replayed up to 3 times.

### Contract Changes (`contracts/src/core/FiseEscrow.sol`)

#### 1. Added `resolveFiseRound(matchId, roundWinner)`
Called by Referee after each round's moves are revealed:

```solidity
function resolveFiseRound(uint256 matchId, uint8 roundWinner) external onlyReferee nonReentrant {
    Match storage m = matches[matchId];
    require(m.status == MatchStatus.ACTIVE, "Match not active");
    require(m.gameLogic == address(this), "Not a FISE match");
    require(roundWinner <= 2, "Invalid winner"); // 0=draw, 1=A, 2=B
    require(m.phase == Phase.REVEAL, "Not in reveal phase");

    if (roundWinner == 1) { m.winsA++; m.drawCounter = 0; }
    else if (roundWinner == 2) { m.winsB++; m.drawCounter = 0; }
    else { m.drawCounter++; }

    emit RoundResolved(matchId, m.currentRound, roundWinner);
    delete roundCommits[matchId][m.currentRound][m.playerA];
    delete roundCommits[matchId][m.currentRound][m.playerB];

    if (m.winsA >= FISE_WINS_REQUIRED || m.winsB >= FISE_WINS_REQUIRED) {
        _settleFiseMatchInternal(matchId);
        return;
    }

    // Handle round progression
    if (roundWinner == 0) {
        if (m.drawCounter >= 3) {
            if (m.currentRound >= MAX_ROUNDS) { _settleFiseMatchInternal(matchId); return; }
            m.currentRound++;
            m.drawCounter = 0;
        }
    } else {
        if (m.currentRound >= MAX_ROUNDS) { _settleFiseMatchInternal(matchId); return; }
        m.currentRound++;
    }

    m.phase = Phase.COMMIT;
    m.commitDeadline = block.timestamp + COMMIT_WINDOW;
    emit RoundStarted(matchId, m.currentRound);
}
```

#### 2. Added `_settleFiseMatchInternal()`
Internal settlement helper called automatically when first-to-3 is reached or max rounds exceeded.

#### 3. Updated `_resolveRound()` Override
Simplified to no-op for FISE matches (referee handles resolution separately):
```solidity
function _resolveRound(uint256 matchId) internal override {
    Match storage m = matches[matchId];
    if (m.gameLogic == address(this)) { return; } // No-op for FISE
    super._resolveRound(matchId);
}
```

#### 4. Added Constant
```solidity
uint8 public constant FISE_WINS_REQUIRED = 3; // Best-of-5 = first to 3
```

#### 5. Settlement Payouts & Rake (CRITICAL)
**Rake is ALWAYS taken (5% total) - even on draws:**
- **Treasury**: 3% of total pot
- **Developer**: 2% of total pot (royalty to game logic developer)
- **Winner** (or split on draw): Remaining 95%

**Winner Payout (first to 3 wins):**
```
payout = (stake * 2) - rake
```
Example: 1 ETH stake each, 2 ETH pot → 1.9 ETH to winner

**Draw Payout (tie at max rounds):**
```
remainingPot = (stake * 2) - rake
splitPayout = remainingPot / 2
```
Example: 1 ETH stake each, 2 ETH pot → 0.95 ETH to each player

**This ensures protocol sustainability - rake is never waived.**

---

### Multi-Round Flow (Event-Driven Cycle)

```
Round N:
  1. Both agents commit → commitMove()
  2. Both agents reveal → revealMove()
  3. MoveRevealed event emitted (fires ONCE PER PLAYER = 2 events per round)
  4. Indexer: Dual-reveal gate — stores in hidden_move first, copies to move when BOTH revealed
  5. Watcher detects event → triggers processing
  6. Reconstructor fetches current_round from matches table, gets moves for that round only
  7. Referee.resolveRound() → executes JS → returns 0/1/2/null
  8. Settler.resolveRound() → calls resolveFiseRound(matchId, winner)
  9. Contract:
     - Updates winsA/winsB
     - Checks for first-to-3 → settles if reached
     - Advances currentRound (or replays on draw)
     - Resets phase to COMMIT
     - Emits RoundStarted
  10. Indexer: Updates current_round in matches table
  11. Agents detect new round on next poll → play next round
  12. Cycle repeats until first-to-3 or max rounds
  13. Contract auto-calls _settleFiseMatchInternal() → MatchSettled
```

---

## Architecture

### How FISE Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   On-Chain       │     │   Falken VM      │     │   IPFS          │
│   (FiseEscrow)  │◄────│   (Referee)      │◄────│   (Game Logic)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │
         │              ┌────────┴────────┐
         │              │   Indexer       │
         │              │   (Supabase)    │
         │              └─────────────────┘
         ▼
┌─────────────────┐
│   Bots          │
│   (Joshua/Agent)│
└─────────────────┘
```

### Key Data Flow: Dual-Reveal Gate

The indexer implements a **dual-reveal gate** to prevent information leakage:
1. When Player A reveals: move stored in `hidden_move` column (NOT `move`). `move` stays null.
2. When Player B reveals: move stored in `hidden_move` column. Then checks if BOTH players have `hidden_move`.
3. If both have `hidden_move`: copies `hidden_move → move` for BOTH players simultaneously.
4. The Watcher's Reconstructor only reads from the `move` column (not `hidden_move`).
5. The Supabase realtime listener triggers on `move=neq.null`, so it fires only after the dual-reveal gate opens.

### Key Data Flow: Watcher Processing

```
MoveRevealed event (blockchain)  ──┐
                                    ├──► processMatch(matchId)
Supabase rounds UPDATE (move≠null) ─┘
                                          │
                                          ├── Lock check (processingLocks)
                                          │     If locked → queue in pendingRetries, return
                                          │
                                          ├── Acquire lock
                                          │
                                          ├── getSyncedMoves() → Reconstructor.getMatchHistory()
                                          │     Reads current_round from matches table
                                          │     Fetches rounds for current_round only
                                          │     Returns moves where move IS NOT NULL
                                          │
                                          ├── If 0 moves → bail (dual-reveal not complete), release lock
                                          │
                                          ├── Fetch JS logic from IPFS (via registry)
                                          │
                                          ├── Referee.resolveRound(jsCode, context, moves)
                                          │     Normalizes move rounds to 1
                                          │     Returns 0 (draw), 1 (A wins), 2 (B wins), or null (pending)
                                          │
                                          ├── If result !== null → Settler.resolveRound(matchId, winner)
                                          │   If result === null → Settler.resolveRound(matchId, 0) // LOGIC_PENDING path
                                          │
                                          └── Hold lock for 10 seconds, then release + check pendingRetries
```

---

## File Changes Summary

### Contracts Modified:
1. `contracts/src/core/FiseEscrow.sol` - Multi-round: `resolveFiseRound`, `_settleFiseMatchInternal`, simplified `_resolveRound`, `FISE_WINS_REQUIRED`
2. `contracts/src/core/MatchEscrow.sol` - Marked `_resolveRound` virtual, fixed `isValidMove` check

### Dashboard Modified:
1. `apps/dashboard/src/app/match/[id]/page.tsx` - FISE badge detection, `is_fise` in Match interface, `salt` in Round interface, PokerHand component renders cards when salt available

### Bots Modified:
1. `packages/house-bot/src/HouseBot.ts` - FISE detection, hash fix, active match tracking, poker hand computation, poker logic ID
2. `packages/reference-agent/src/SimpleAgent.ts` - FISE detection, hash fix, salt-first flow, hand computation, enhanced LLM prompt, uint8 clamp
3. `packages/llm-house-bot/src/index.ts` - **THIS IS JOSHUA** — Salt-first flow, hand computation, salt reuse on retry, uint8 clamp, enhanced Gemini prompt

### Indexer Modified:
1. `packages/indexer/src/index.ts` - Fixed `MatchSettled` ABI (indexed flag), FISE winner back-propagation, chunk size 2000, dual-reveal gate with `hidden_move`, salt extraction from tx calldata via `decodeFunctionData`

### Falken VM Modified:
1. `packages/falken-vm/src/Referee.ts` - `resolveRound()`, `normalizeResult()`, `RoundWinner` type (includes `null` for pending)
2. `packages/falken-vm/src/Settler.ts` - `resolveRound()` method, updated ABI with `resolveFiseRound`, pending nonce
3. `packages/falken-vm/src/Watcher.ts` - `resolveRound()` calls, processing lock with event queue (`pendingRetries`), dual-reveal bail, LOGIC_PENDING Draw(0) path, 10-second lock hold
4. `packages/falken-vm/src/Reconstructor.ts` - Current-round-only filtering (`match.current_round`)

---

## Start Commands

```bash
# Terminal 1: Indexer
cd ~/Desktop/FALKEN && pnpm -F indexer start

# Terminal 2: Watcher (Falken VM)
cd ~/Desktop/FALKEN && pnpm -F @falken/vm build && pnpm -F @falken/vm start

# Terminal 3: Joshua (LLM House Bot)
cd ~/Desktop/FALKEN && pnpm -F llm-house-bot build && pnpm -F llm-house-bot start

# Terminal 4: SimpleAgent (Reference Agent)
cd ~/Desktop/FALKEN && pnpm -F reference-agent build && pnpm -F reference-agent start

# Terminal 5: Dashboard
cd ~/Desktop/FALKEN && pnpm -F dashboard dev
```

---

## Troubleshooting

### "Invalid hash" on reveal
- Check hash calculation uses `uint256` for round/move
- Verify salt was saved correctly in salts.json
- Check if salt was regenerated after a failed commit (Fix 16)

### "Commit deadline passed"
- Both bots must commit within 30 minutes of match start
- Run bots concurrently to avoid timeouts

### Falken VM: "Match not found"
- **Indexer not synced** - Start the indexer first
- Matches are looked up in Supabase by `match_id`

### Bot: "Insufficient funds"
- HouseBot needs ~0.0015 ETH (stake + gas)
- SimpleAgent needs ~0.0015 ETH
- Referee needs ~0.01 ETH (gas for settlements)

### "Only Referee can call"
- Check `referee()` address on contract
- Use correct private key for settlement

### Dashboard shows "??" instead of "FISE"
- Ensure `NEXT_PUBLIC_ESCROW_ADDRESS` is set in `.env`
- Check `is_fise` flag is being set by indexer (FiseMatchCreated handler)

### Settled matches show as ACTIVE
- Check indexer ABI: `MatchSettled.winner` must be `indexed: false`
- Re-index from deployment block after fixing

### Joshua not revealing (rounds 2+) 🔴 OPEN
- See "CRITICAL OPEN BUG" section above
- All known fixes have been applied but the issue persists
- Likely a timing/race condition between the Watcher settling and Joshua polling

### Dashboard shows "NO ACTION" for a player
- Usually means the player never revealed before the round was settled
- Check bot logs for reveal errors (salt mismatch, nonce, uint8 overflow)
- Check if Watcher settled prematurely

### Move value out-of-bounds (uint8)
- Poker discard moves must be < 256
- Max 2 card discards to stay within uint8
- Code clamps moves > 255 to top 2 indices

---

## Deployment Steps (If Redeploy Needed)

### Step 1: Deploy LogicRegistry
```bash
forge create contracts/src/core/LogicRegistry.sol:LogicRegistry \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $PRIVATE_KEY --verify
```

### Step 2: Deploy PriceProvider
```bash
forge create contracts/src/core/PriceProvider.sol:PriceProvider \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $PRIVATE_KEY \
  --constructor-args $CHAINLINK_ETH_USD_FEED $MIN_STAKE_USD --verify
```

### Step 3: Deploy FiseEscrow
```bash
forge create contracts/src/core/FiseEscrow.sol:FiseEscrow \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $PRIVATE_KEY \
  --constructor-args $TREASURY $PRICE_PROVIDER $LOGIC_REGISTRY $REFEREE --verify
```

### Step 4: Register Game Logic
```bash
# RPS
cast send $LOGIC_REGISTRY "registerLogic(string,bytes32)" \
  "QmcaiTUUvhQH6oLz361R2AYbaZMJPmZYeoN3N4cBxuSXQs" \
  0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3 \
  --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY

# Poker Blitz
cast send $LOGIC_REGISTRY "registerLogic(string,bytes32)" \
  "QmYX1y7mASoDr9sL8t7P1e1FE4ZKjLYJ65UXh7VLbTMvR6" \
  0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4 \
  --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY
```

### Step 5: Update .env
```bash
ESCROW_ADDRESS=0x...
NEXT_PUBLIC_ESCROW_ADDRESS=0x...
PRICE_PROVIDER_ADDRESS=0x...
LOGIC_REGISTRY_ADDRESS=0x...
REFEREE_PRIVATE_KEY=0x...
HOUSE_BOT_PRIVATE_KEY=0x...
GEMINI_API_KEY=...
```

### Step 6: Build and Test
```bash
cd ~/Desktop/FALKEN
pnpm -F indexer start                    # Terminal 1
pnpm -F @falken/vm build && pnpm -F @falken/vm start  # Terminal 2
pnpm -F llm-house-bot build && pnpm -F llm-house-bot start  # Terminal 3
pnpm -F reference-agent build && pnpm -F reference-agent start  # Terminal 4
```
