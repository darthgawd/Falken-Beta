# PROJECT FALKEN: FISE Complete Implementation Guide

## Overview

FISE (Falken Immutable Scripting Engine) allows JavaScript-based games to be played on-chain. This document provides the complete implementation guide including all fixes, contract changes, and deployment steps.

**Last Updated**: 2026-02-28
**Status**: ✅ OPERATIONAL (single-round) | ✅ IMPLEMENTED: Best-of-5 multi-round contract | 🔧 NEXT: Deploy and test multi-round

---

## Current Testnet Deployment (Base Sepolia)

| Contract | Address | Status |
|----------|---------|--------|
| **FiseEscrow** | `0xE155B0F15dfB5D65364bca23a08501c7384eb737` | ✅ Live (single-round) |
| **Logic Registry** | `0xc87d466e9F2240b1d7caB99431D1C80a608268Df` | ✅ Live |
| **Price Provider** | `0xFd2f3194b866DbE7115447B6b79C0972CcEDE3Ca` | ✅ Live |
| **RPS Logic ID** | `0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3` | ✅ Registered |

**Bot Wallets**:
- **HouseBot (Joshua)**: `0xb63Ec09E541bC2eF1Bf2bB4212fc54a6Dac0C5f4`
- **SimpleAgent**: `0xAc4E9F0D2d5998cC6F05dDB1BD57096Db5dBc64A`
- **Referee**: `0xCfF9cEA16c4731B6C8e203FB83FbbfbB16A2DFF2`

---

## Recent Fixes Applied (2026-02-28)

### Fix 6: Indexer MatchSettled ABI Mismatch ✅

**Problem**: `parseEventLogs` silently dropped all `MatchSettled` events because the ABI declared `winner` as `indexed: true` but the actual contract emits it as non-indexed data (in `data` field, not `topics`). Result: matches showed ACTIVE in Supabase even though they were SETTLED on-chain.

**File**: `packages/indexer/src/index.ts`

**Solution**: Changed `winner` from `indexed: true` to `indexed: false`:
```typescript
// BEFORE (wrong - expected 3 topics but event only has 2):
{ name: 'MatchSettled', inputs: [
  { name: 'matchId', indexed: true },
  { name: 'winner', indexed: true },    // ← WRONG
  { name: 'payout', indexed: false }
]}

// AFTER (correct - matches on-chain event signature):
{ name: 'MatchSettled', inputs: [
  { name: 'matchId', indexed: true },
  { name: 'winner', indexed: false },   // ← FIXED
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
// Track active matches with real opponent
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
/// @dev Resolves a single FISE round. Called by Referee after off-chain evaluation.
/// Mirrors MatchEscrow._resolveRound() but with winner determined off-chain.
function resolveFiseRound(uint256 matchId, uint8 roundWinner) external onlyReferee nonReentrant {
    Match storage m = matches[matchId];
    require(m.status == MatchStatus.ACTIVE, "Match not active");
    require(m.gameLogic == address(this), "Not a FISE match");
    require(roundWinner <= 2, "Invalid winner"); // 0=draw, 1=A, 2=B
    require(m.phase == Phase.REVEAL, "Not in reveal phase");

    // Update wins/draws (mirrors MatchEscrow._resolveRound)
    if (roundWinner == 1) {
        m.winsA++;
        m.drawCounter = 0;
    } else if (roundWinner == 2) {
        m.winsB++;
        m.drawCounter = 0;
    } else {
        m.drawCounter++;
    }

    emit RoundResolved(matchId, m.currentRound, roundWinner);

    // Cleanup round storage
    delete roundCommits[matchId][m.currentRound][m.playerA];
    delete roundCommits[matchId][m.currentRound][m.playerB];

    // Check for match winner (first to 3)
    if (m.winsA >= FISE_WINS_REQUIRED || m.winsB >= FISE_WINS_REQUIRED) {
        _settleFiseMatchInternal(matchId);
        return;
    }

    // Handle round progression
    if (roundWinner == 0) {
        // Draw — replay same round, up to 3 consecutive draws
        if (m.drawCounter >= 3) {
            if (m.currentRound >= MAX_ROUNDS) {
                _settleFiseMatchInternal(matchId);
                return;
            }
            m.currentRound++;
            m.drawCounter = 0;
        }
        // else: stay on same round (sudden death replay)
    } else {
        // Non-draw — advance to next round
        if (m.currentRound >= MAX_ROUNDS) {
            _settleFiseMatchInternal(matchId);
            return;
        }
        m.currentRound++;
    }

    // Reset for next round
    m.phase = Phase.COMMIT;
    m.commitDeadline = block.timestamp + COMMIT_WINDOW;
    emit RoundStarted(matchId, m.currentRound);
}
```

#### 2. Added `_settleFiseMatchInternal()`
Internal settlement helper called automatically when first-to-3 is reached or max rounds exceeded:

```solidity
/// @dev Internal FISE settlement with developer royalties.
function _settleFiseMatchInternal(uint256 matchId) internal {
    Match storage m = matches[matchId];
    m.status = MatchStatus.SETTLED;
    m.phase = Phase.REVEAL; // Mark finished

    bytes32 logicId = fiseMatches[matchId];
    uint256 totalPot = m.stake * 2;
    (, address developer,,,) = logicRegistry.registry(logicId);
    logicRegistry.recordVolume(logicId, totalPot);

    if (m.winsA == m.winsB) {
        // Draw — refund both
        _safeTransfer(m.playerA, m.stake);
        _safeTransfer(m.playerB, m.stake);
        emit MatchSettled(matchId, address(0), m.stake);
    } else {
        address winner = m.winsA > m.winsB ? m.playerA : m.playerB;
        uint256 totalRake = (totalPot * RAKE_BPS) / 10000;
        uint256 royalty = (totalPot * 200) / 10000; // 2% Royalty
        uint256 protocolFee = totalRake - royalty;  // 3% Protocol
        uint256 payout = totalPot - totalRake;

        _safeTransfer(treasury, protocolFee);
        _safeTransfer(developer, royalty);
        _safeTransfer(winner, payout);
        emit MatchSettled(matchId, winner, payout);
    }
}
```

#### 3. Updated `_resolveRound()` Override
Simplified to no-op for FISE matches (referee handles resolution separately):

```solidity
function _resolveRound(uint256 matchId) internal override {
    Match storage m = matches[matchId];
    if (m.gameLogic == address(this)) {
        return; // No-op. Referee calls resolveFiseRound() separately.
    }
    super._resolveRound(matchId);
}
```

#### 4. Added Constant
```solidity
uint8 public constant FISE_WINS_REQUIRED = 3; // Best-of-5 = first to 3
```

#### 5. Kept Legacy `settleFiseMatch()`
For single-round matches or early settlement (timeout, forfeit).

---

### FalkenVM Changes

#### `Settler.ts` - Added `resolveRound()` method
```typescript
const FISE_ESCROW_ABI = [
  { 
    name: 'settleFiseMatch', 
    type: 'function', 
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'winner', type: 'address' }
    ],
    outputs: [] 
  },
  {
    name: 'resolveFiseRound',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundWinner', type: 'uint8' }
    ],
    outputs: []
  }
] as const;

async resolveRound(escrowAddress: `0x${string}`, matchId: bigint, roundWinner: number) {
    logger.info({ matchId: matchId.toString(), roundWinner }, 'INITIATING_ROUND_RESOLUTION');
    
    const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'resolveFiseRound',
        args: [matchId, roundWinner as 0 | 1 | 2]
    });
    
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    logger.info({ matchId: matchId.toString(), roundWinner, status: receipt.status }, 
                 'ROUND_RESOLUTION_CONFIRMED');
    return hash;
}
```

#### `Referee.ts` - Added `resolveRound()` method
```typescript
export type RoundWinner = 0 | 1 | 2;

async resolveRound(jsCode: string, context: MatchContext, moves: GameMove[]): Promise<RoundWinner> {
    const currentRound = moves[0]?.round || 1;
    
    // Transform and execute JS code
    const transformedCode = this.transformJsCode(jsCode);
    const runLogic = new Function('context', 'moves', `...`);
    const result = runLogic(context, moves);
    
    // Normalize result to 0/1/2
    return this.normalizeResult(result, context);
}

private normalizeResult(result: any, context: MatchContext): RoundWinner {
    // Handle numeric results
    if (typeof result === 'number' && result >= 0 && result <= 2) {
        return result as RoundWinner;
    }
    // Handle string results
    if (typeof result === 'string') {
        const lower = result.toLowerCase().trim();
        if (lower === 'draw' || lower === '0' || lower === 'tie') return 0;
        if (lower === 'a' || lower === '1' || lower === 'playera') return 1;
        if (lower === 'b' || lower === '2' || lower === 'playerb') return 2;
        if (lower === context.playerA.toLowerCase()) return 1;
        if (lower === context.playerB.toLowerCase()) return 2;
    }
    return 0; // Default to draw
}
```

#### `Watcher.ts` - Updated to use `resolveRound()`
```typescript
// Multi-Round: Resolve current round (returns 0, 1, or 2)
const roundWinner: RoundWinner = await this.referee.resolveRound(jsCode, context, moves);
logger.info({ dbMatchId, roundWinner, round: currentRound }, 'ROUND_JUDGMENT_RENDERED');

if (dbMatchId.startsWith('test-fise')) {
    // SIMULATION: Track wins in Supabase
    // Check for match completion (first to 3)
    const isComplete = winsA >= 3 || winsB >= 3 || currentRound >= 5;
    // Update DB with wins_a, wins_b, current_round
} else {
    // REAL ON-CHAIN: Call resolveFiseRound
    await this.settler.resolveRound(escrowAddress, onChainMatchId, roundWinner);
}
```

---

### Multi-Round Flow (Event-Driven Cycle)

```
Round N:
  1. Both agents commit → commitMove()
  2. Both agents reveal → revealMove()
  3. MoveRevealed event emitted
  4. Watcher detects event → triggers processing
  5. Referee.resolveRound() → executes JS → returns 0/1/2
  6. Settler.resolveRound() → calls resolveFiseRound(matchId, winner)
  7. Contract:
     - Updates winsA/winsB
     - Checks for first-to-3 → settles if reached
     - Advances currentRound (or replays on draw)
     - Resets phase to COMMIT
     - Emits RoundStarted
  8. Agents detect RoundStarted → play next round
  9. Cycle repeats until first-to-3 or max rounds
  10. Contract auto-calls _settleFiseMatchInternal() → MatchSettled
```

---

## Critical Fixes Applied (2026-02-27, Previous Session)

### Fix 1: FISE Match Resolution ✅
Override `_resolveRound()` to skip on-chain resolution for FISE matches (emits `RoundResolved(matchId, round, 0)` and returns).

### Fix 2: Reveal Move Validation ✅
Skip `IGameLogic.isValidMove()` check for FISE matches (gameLogic is escrow address, not a logic contract).

### Fix 3: Bot Hash Calculation ✅
Use `uint256` for round/move in hash (was `uint8`).

### Fix 4: Bot FISE Detection ✅
Check if `gameLogic == escrowAddress` before calling `gameType()`.

### Fix 5: Bot Multiple Match Creation (Initial) ✅
Track waiting matches (ACTIVE but no opponent).

---

## Deployment Notes for Multi-Round Contract

### What Changed
The multi-round implementation requires a **new contract deployment** since it adds:
1. `resolveFiseRound()` function
2. `_settleFiseMatchInternal()` helper
3. `FISE_WINS_REQUIRED` constant (3)
4. Updated `_resolveRound()` override

### Files Modified

| File | Change |
|------|--------|
| `contracts/src/core/FiseEscrow.sol` | ✅ Added `resolveFiseRound()`, `_settleFiseMatchInternal()`, simplified `_resolveRound()` |
| `packages/falken-vm/src/Settler.ts` | ✅ Added `resolveRound()` method + ABI |
| `packages/falken-vm/src/Referee.ts` | ✅ Added `resolveRound()`, `normalizeResult()`, `RoundWinner` type |
| `packages/falken-vm/src/Watcher.ts` | ✅ Call `settler.resolveRound()` instead of `settler.settle()` |

### No Changes Needed (Confirmed)
- **HouseBot** — already polls `currentRound`, plays whatever round contract shows
- **SimpleAgent** — same
- **Indexer** — already handles `RoundStarted`, `RoundResolved`, score sync
- **Dashboard** — already renders multi-round battle log
- **Database schema** — already supports multi-round

### Deployment Steps
1. Compile and deploy new FiseEscrow contract
2. Set referee address on new contract
3. Update `.env` with new contract addresses
4. Register game logic on new contract's registry (or reuse existing registry)
5. Reset indexer sync_state to new deployment block
6. Restart all services and test end-to-end

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

### Single Round Flow (Legacy):
1. **Create**: HouseBot calls `createFiseMatch(stake, logicId)`
2. **Join**: SimpleAgent calls `joinMatch(matchId)`
3. **Commit**: Both call `commitMove(matchId, hash)`
4. **Reveal**: Both call `revealMove(matchId, move, salt)`
5. **Settle**: Referee calls `settleFiseMatch(matchId, winner)`

### Multi-Round Flow (Best-of-5) - ✅ IMPLEMENTED:
1. **Create**: HouseBot calls `createFiseMatch(stake, logicId)`
2. **Join**: SimpleAgent calls `joinMatch(matchId)`
3. **Round Loop** (repeats up to 5 rounds, first to 3 wins):
   - **Commit**: Both call `commitMove(matchId, hash)`
   - **Reveal**: Both call `revealMove(matchId, move, salt)`
   - **Resolve**: FalkenVM detects reveals, executes JS, calls `resolveFiseRound(matchId, roundWinner)`
   - Contract updates wins, checks for first-to-3, advances `currentRound`, resets phase to COMMIT
   - Draws replay same round (up to 3 consecutive draws)
   - Emits `RoundStarted` for next round
4. **Auto-Settle**: Contract auto-calls `_settleFiseMatchInternal()` when first-to-3 reached

---

## Troubleshooting

### "Invalid hash" on reveal
- Check hash calculation uses `uint256` for round/move
- Verify salt was saved correctly in salts.json

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

---

## File Changes Summary

### Contracts Modified:
1. `contracts/src/core/FiseEscrow.sol` - ✅ Multi-round: `resolveFiseRound`, `_settleFiseMatchInternal`, simplified `_resolveRound`, `FISE_WINS_REQUIRED`
2. `contracts/src/core/MatchEscrow.sol` - Marked `_resolveRound` virtual, fixed `isValidMove` check

### Dashboard Modified:
1. `apps/dashboard/src/app/match/[id]/page.tsx` - FISE badge detection, `is_fise` in Match interface

### Bots Modified:
1. `packages/house-bot/src/HouseBot.ts` - FISE detection, hash fix, active match tracking (3 states)
2. `packages/reference-agent/src/SimpleAgent.ts` - FISE detection, hash fix

### Indexer Modified:
1. `packages/indexer/src/index.ts` - Fixed `MatchSettled` ABI (indexed flag), FISE winner back-propagation, chunk size 2000

### Falken VM (Multi-Round Update):
1. `packages/falken-vm/src/Referee.ts` - ✅ Added `resolveRound()`, `normalizeResult()`, `RoundWinner` type
2. `packages/falken-vm/src/Settler.ts` - ✅ Added `resolveRound()` method, updated ABI with `resolveFiseRound`
3. `packages/falken-vm/src/Watcher.ts` - ✅ Calls `resolveRound()` instead of `settle()`, tracks wins in simulation
4. `packages/falken-vm/src/Reconstructor.ts` - Match history from Supabase

---

## Testing Checklist

### Single Round (✅ Complete)
- [x] HouseBot creates FISE match successfully
- [x] SimpleAgent joins FISE match
- [x] Both bots commit moves
- [x] Both bots reveal moves (no "Invalid hash" error)
- [x] HouseBot does NOT create duplicate matches (3-state gate)
- [x] After reveal, match waits for referee settlement
- [x] Referee can call settleFiseMatch() with winner
- [x] Winner receives payout minus 5% rake (3% treasury, 2% developer)
- [x] Falken VM auto-detects and settles
- [x] Indexer processes MatchSettled events correctly
- [x] Dashboard shows FISE badge (not "??")
- [x] Dashboard shows SETTLED status for settled matches
- [x] Dashboard shows settlement TX link

### Multi-Round (✅ Implemented, 🔧 Needs Deployment & Testing)
- [x] Contract: `resolveFiseRound()` implemented
- [x] Contract: `_settleFiseMatchInternal()` implemented
- [x] Contract: `_resolveRound()` simplified to no-op
- [x] FalkenVM: `Settler.resolveRound()` implemented
- [x] FalkenVM: `Referee.resolveRound()` returns 0/1/2
- [x] FalkenVM: `Watcher` calls `resolveRound()` instead of `settle()`
- [ ] Deploy new FiseEscrow contract
- [ ] Test: Match plays multiple rounds
- [ ] Test: First-to-3 wins triggers auto-settlement
- [ ] Test: Draws replay same round
- [ ] Test: Max rounds (5) triggers settlement

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

Set manual price if needed:
```bash
cast send $PRICE_PROVIDER "setManualPrice(uint256)" 300000000000 \
  --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY
```

### Step 3: Deploy FiseEscrow
```bash
forge create contracts/src/core/FiseEscrow.sol:FiseEscrow \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $PRIVATE_KEY \
  --constructor-args $TREASURY $PRICE_PROVIDER $LOGIC_REGISTRY $REFEREE --verify
```

### Step 4: Register Game Logic
```bash
cast send $LOGIC_REGISTRY "registerLogic(string,bytes32)" \
  "QmcaiTUUvhQH6oLz361R2AYbaZMJPmZYeoN3N4cBxuSXQs" \
  0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3 \
  --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY
```

### Step 5: Update .env
```bash
ESCROW_ADDRESS=0x...
FISE_ESCROW_ADDRESS=0x...
NEXT_PUBLIC_ESCROW_ADDRESS=0x...
PRICE_PROVIDER_ADDRESS=0x...
LOGIC_REGISTRY_ADDRESS=0x...
REFEREE_PRIVATE_KEY=0x...
```

### Step 6: Build and Test
```bash
cd ~/Desktop/FALKEN
npx tsx packages/indexer/src/index.ts        # Terminal 1
npx tsx packages/falken-vm/src/index.ts      # Terminal 2
npx tsx packages/house-bot/src/HouseBot.ts   # Terminal 3
npx tsx packages/reference-agent/src/SimpleAgent.ts  # Terminal 4
```
