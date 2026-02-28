# FISE Auto-Settlement Handoff

**Date:** 2026-02-28  
**Status:** ✅ Multi-Round FISE Implemented | 🔧 Ready for Deployment & Testing

---

## What's Working

### 1. Smart Contract - Multi-Round FISE (IMPLEMENTED, Needs Deploy)

**Multi-Round Support - IMPLEMENTED**
- File: `contracts/src/core/FiseEscrow.sol`
- Best-of-5 (first to 3 wins) with draws replayed up to 3 times
- New function: `resolveFiseRound(matchId, roundWinner)` - called by Referee after each round
- Auto-settlement when first-to-3 reached or max rounds exceeded
- **Rake ALWAYS taken** (even on draws): 5% total (3% treasury, 2% developer)

**Previous Fixes (Still Active):**
- Multiple Match Creation Bug - `waitingMatchesByLogic` tracking
- Reveal Revert - Skip `isValidMove()` for FISE matches
- `_resolveRound` Override - No-op for FISE (referee handles resolution)
- Hash Calculation - `uint256` for round/move

### 2. FalkenVM - Multi-Round Support (IMPLEMENTED)

**Settler.ts**
- Added `resolveRound(escrowAddress, matchId, roundWinner)` method
- Calls `resolveFiseRound()` on-chain
- ABI includes both `resolveFiseRound` and `settleFiseMatch`

**Referee.ts**
- Added `resolveRound()` returning `RoundWinner` (0/1/2)
- Added `normalizeResult()` helper for various game result types
- Returns round winner instead of match winner address

**Watcher.ts**
- Calls `settler.resolveRound()` instead of `settler.settle()`
- Tracks wins in simulation mode
- Handles multi-round event cycle

### 3. Test Coverage - 90%+ (ACHIEVED)

**FiseEscrow.sol Coverage:**
- Lines: **98.11%** (104/106)
- Statements: **98.33%** (118/120)
- Branches: **97.67%** (42/43)
- Functions: **100%** (8/8)

**New Tests Added (25+):**
- `resolveFiseRound()` - player A/B wins, draws
- Multiple rounds to settlement (first to 3)
- Draw limit (3 consecutive draws → advance round)
- Max rounds settlement (5 rounds)
- Auto-settlement with correct payouts
- Round commit cleanup
- All revert conditions
- Event emissions

---

## Multi-Round FISE Rules

### Game Flow
```
Round N:
  1. Both agents commit → commitMove()
  2. Both agents reveal → revealMove()
  3. MoveRevealed event emitted
  4. FalkenVM detects event
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

### Draw Rules

| Situation | Result |
|-----------|--------|
| Draw in any round | Replay same round |
| 3 consecutive draws | Advance to next round (or settle if at max) |
| At max rounds (5), 3 draws | **Immediate settlement** |

### Settlement Payouts

**Winner (first to 3 wins):**
- Winner gets: `totalPot - rake` (95% of pot)
- Treasury: 3%
- Developer: 2%

**Draw (tie at max rounds or equal wins):**
- Each player gets: `(totalPot - rake) / 2`
- Treasury: 3% (always taken)
- Developer: 2% (always taken)

**Example (1 ETH stake each, draw):**
- Total pot: 2 ETH
- Rake: 0.1 ETH (5%)
- Remaining: 1.9 ETH
- Each player gets: **0.95 ETH**

---

## Contract Changes Summary

### FiseEscrow.sol

```solidity
// New constant
uint8 public constant FISE_WINS_REQUIRED = 3;

// New event
event RoundStarted(uint256 indexed matchId, uint8 round);

// New function - resolves a single round
function resolveFiseRound(uint256 matchId, uint8 roundWinner) external onlyReferee nonReentrant

// New internal settlement (auto-called when match ends)
function _settleFiseMatchInternal(uint256 matchId) internal

// Updated - simplified to no-op
function _resolveRound(uint256 matchId) internal override

// Updated - rake always taken on draws
function settleFiseMatch(uint256 matchId, address winner) external onlyReferee nonReentrant
```

### FalkenVM Files

| File | Change |
|------|--------|
| `packages/falken-vm/src/Settler.ts` | Added `resolveRound()` method + ABI |
| `packages/falken-vm/src/Referee.ts` | Added `resolveRound()`, `RoundWinner` type, `normalizeResult()` |
| `packages/falken-vm/src/Watcher.ts` | Calls `resolveRound()` instead of `settle()` |

---

## Files Modified

### Contracts
- `contracts/src/core/FiseEscrow.sol` - Multi-round support, rake on draws

### FalkenVM
- `packages/falken-vm/src/Settler.ts`
- `packages/falken-vm/src/Referee.ts`
- `packages/falken-vm/src/Watcher.ts`

### Tests
- `contracts/test/FISE.t.sol` - 25+ new multi-round tests

---

## Deployment Steps

1. **Compile and deploy new FiseEscrow contract**
   ```bash
   forge create contracts/src/core/FiseEscrow.sol:FiseEscrow \
     --rpc-url $BASE_SEPOLIA_RPC --private-key $PRIVATE_KEY \
     --constructor-args $TREASURY $PRICE_PROVIDER $LOGIC_REGISTRY $REFEREE
   ```

2. **Set referee address on new contract**
   ```bash
   cast send $NEW_ESCROW "setReferee(address)" $REFEREE_ADDRESS
   ```

3. **Update .env with new contract address**
   ```bash
   ESCROW_ADDRESS=0x...
   FISE_ESCROW_ADDRESS=0x...
   NEXT_PUBLIC_ESCROW_ADDRESS=0x...
   ```

4. **Reset indexer sync_state to deployment block**

5. **Restart all services and test end-to-end**

---

## Architecture Summary

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  HouseBot   │────▶│  FiseEscrow  │────▶│   Events    │
│ (Joshua)    │     │(Multi-Round) │     │             │
└─────────────┘     └──────────────┘     └──────┬──────┘
       │                                        │
       │    ┌──────────────┐                    │
       └───▶│ ReferenceAgent│◀───────────────────┘
            │ (SimpleAgent) │
            └───────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  Falken VM  │
                   │  (Referee)  │
                   └──────┬──────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  IPFS/JS    │
                   │  Game Logic │
                   └─────────────┘
```

**Multi-Round Flow:**
1. HouseBot creates FISE match (status=Open, round=1)
2. ReferenceAgent joins match (status=Active)
3. Round 1: Both commit → Both reveal → FalkenVM resolves → Contract updates
4. If no winner: Round 2 starts (RoundStarted event)
5. Repeat until first-to-3 wins or max rounds reached
6. Auto-settlement with rake distribution

---

## Testing Checklist

### Single Round (Legacy)
- [x] HouseBot creates FISE match
- [x] SimpleAgent joins FISE match
- [x] Both bots commit/reveal
- [x] Referee can call settleFiseMatch()
- [x] Winner receives payout minus rake

### Multi-Round (New)
- [x] Match plays multiple rounds
- [x] First-to-3 wins triggers auto-settlement
- [x] Draws replay same round
- [x] 3 draws advance round
- [x] Max rounds (5) triggers settlement
- [x] **Rake taken on draws**
- [x] Correct payout calculations

### To Test After Deployment
- [ ] End-to-end multi-round match
- [ ] Draw at max rounds settles correctly
- [ ] Rake distributed correctly on draws
- [ ] RoundStarted events fire correctly
- [ ] Bots auto-play subsequent rounds

---

## Useful Commands

```bash
# Check match status
cast call $ESCROW "getMatch(uint256)" <MATCH_ID> --rpc-url https://sepolia.base.org

# Check match counter
cast call $ESCROW "matchCounter()" --rpc-url https://sepolia.base.org

# Manual settle (legacy single-round)
cast send $ESCROW "settleFiseMatch(uint256,uint8)" <MATCH_ID> <WINNER> \
  --rpc-url https://sepolia.base.org --private-key <KEY>

# Manual resolve round (multi-round)
cast send $ESCROW "resolveFiseRound(uint256,uint8)" <MATCH_ID> <ROUND_WINNER> \
  --rpc-url https://sepolia.base.org --private-key <KEY>
# roundWinner: 0=draw, 1=playerA, 2=playerB
```

---

## Environment

Network: Base Sepolia
Current Escrow: 0xE155B0F15dfB5D65364bca23a08501c7384eb737 (single-round)
Registry: 0xc87d466e9F2240b1d7caB99431D1C80a608268Df

**Bot Wallets:**
- HouseBot (Joshua): `0xb63ec09e541bc2ef1bf2bb4212fc54a6dac0c5f4`
- ReferenceAgent: `0xAc4E9F0D2d5998cC6F05dDB1BD57096Db5dBc64A`
- Referee: `0xCfF9cEA16c4731B6C8e203FB83FbbfbB16A2DFF2`

---

## Git Commits (fise-dev-2 branch)

- `85bf6dc` - feat: Multi-round FISE support (best-of-5)
- `eedaa28` - fix: Add missing RoundStarted event
- `b9be706` - test: Comprehensive FISE multi-round test coverage (90%+)
- `4788261` - fix: Always take rake on draw settlements

---

## Notes

**Critical: Rake on Draws**
The contract now ALWAYS takes rake, even when the match ends in a draw. This ensures protocol sustainability. Both players receive their stake minus half the rake.

**Example:**
- Stake: 1 ETH each (2 ETH total)
- Rake: 0.1 ETH (5%)
- Each player receives: 0.95 ETH
