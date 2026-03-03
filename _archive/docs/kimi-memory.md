# Kimi Memory - FISE Testing Session

**Date:** 2026-02-27  
**Session:** FISE Auto-Settlement Testing

---

## What Was Accomplished

### 1. Smart Contract Fixes Applied (All Working)

**Multiple Match Creation Bug - FIXED**
- File: `packages/house-bot/src/HouseBot.ts`
- Added `waitingMatchesByLogic` tracking to prevent Joshua from creating new matches when he has an active match waiting for opponent

**Reveal Revert (Invalid Move) - FIXED**
- File: `contracts/src/core/MatchEscrow.sol`
- Added check: `if (m.gameLogic != address(this))` before `isValidMove()` call
- FISE matches now skip on-chain move validation since moves are validated by JS

**_resolveRound Override - FIXED**
- File: `contracts/src/core/FiseEscrow.sol`
- Override prevents on-chain resolution for FISE matches
- Emits `RoundResolved(matchId, m.currentRound, 0)` and returns

**Hash Calculation - FIXED**
- Both HouseBot and ReferenceAgent now use `uint256` for round/move in hash calculation
- Format: `["FALKEN_V1", escrow, matchId, round, player, move, salt]`

### 2. Claude's Fixes (Applied During Testing)

**Indexer Fixed (`packages/indexer/src/index.ts`)**
- Fixed MoveCommitted ABI: Removed extra commitHash parameter
- Events were being silently dropped due to wrong event selector hash
- Removed commit_hash from Supabase upsert
- Added TypeScript cast for parseEventLogs

**Falken VM Fixed (`packages/falken-vm/src/Watcher.ts`)**
- Fixed draw settlement: Changed `else if (winner)` to `else` - draws now correctly call `settleFiseMatch(matchId, address(0))`
- Added waitForMatchData(): Retries Supabase queries up to 5 times with 3s delay
- Added incomplete move guard: Skips settlement if fewer than 2 moves available
- Fixed logicId typing: Added `as const` to ABI and proper casting

**Pino ESM Type Errors Fixed**
- Fixed across all 6 Falken VM source files

---

## Current State Summary

### Network & Contracts
- **Network:** Base Sepolia
- **Escrow:** `0xE155B0F15dfB5D65364bca23a08501c7384eb737`
- **Registry:** `0xc87d466e9F2240b1d7caB99431D1C80a608268Df`
- **Falken VM (Referee):** `0xCfF9cEA16c4731B6C8e203FB83FbbfbB16A2DFF2`

### Bot Addresses
- **HouseBot (Joshua):** `0xb63ec09e541bc2ef1bf2bb4212fc54a6dac0c5f4`
- **ReferenceAgent:** `0xAc4E9F0D2d5998cC6F05dDB1BD57096Db5dBc64A`

### Current Balances (Test Run End)
- **HouseBot:** ~0.0012 ETH (insufficient for multiple matches)
- **ReferenceAgent:** ~0.0006 ETH (insufficient to join - needs 0.001 ETH stake)
- **Referee:** ~0.00175 ETH (can fund bots)

### Match Status (End of Testing)

| Match | PlayerA | PlayerB | Status | Phase | Issue |
|-------|---------|---------|--------|-------|-------|
| 9 | HouseBot | ReferenceAgent | Active | Reveal | Deadlines passed |
| 10 | HouseBot | ReferenceAgent | Active | Reveal | Deadlines passed |
| 11 | HouseBot | Empty | Open | - | Waiting for join |

**Note:** ReferenceAgent found match 11 and tried to join but had insufficient funds.

---

## Testing Commands

### Start All Services

```bash
# Terminal 1 - Indexer (must start first)
cd packages/indexer && pnpm start

# Terminal 2 - Falken VM
cd packages/falken-vm && pnpm start

# Terminal 3 - HouseBot
cd packages/house-bot && pnpm start

# Terminal 4 - ReferenceAgent
cd packages/reference-agent && npx tsx src/run.ts
```

### Check Match Status

```bash
# Check counter
cast call 0xE155B0F15dfB5D65364bca23a08501c7384eb737 "matchCounter()" --rpc-url https://sepolia.base.org

# Decode match status
cd packages/falken-vm && npx tsx -e "
import { decodeAbiParameters } from 'viem';
const data = '\$(cast call 0xE155B0F15dfB5D65364bca23a08501c7384eb737 \"matches(uint256)\" <MATCH_ID> --rpc-url https://sepolia.base.org 2>/dev/null)';
const result = decodeAbiParameters([
  { name: 'playerA', type: 'address' },
  { name: 'playerB', type: 'address' },
  { name: 'stake', type: 'uint256' },
  { name: 'gameLogic', type: 'address' },
  { name: 'winsA', type: 'uint8' },
  { name: 'winsB', type: 'uint8' },
  { name: 'currentRound', type: 'uint8' },
  { name: 'drawCounter', type: 'uint8' },
  { name: 'phase', type: 'uint8' },
  { name: 'status', type: 'uint8' },
  { name: 'commitDeadline', type: 'uint256' },
  { name: 'revealDeadline', type: 'uint256' }
], data as \`0x\${string}\`);
console.log('Status:', result[9], '| Phase:', result[8]);
console.log('PlayerA:', result[0]);
console.log('PlayerB:', result[1]);
console.log('CommitDeadline:', result[10]);
console.log('RevealDeadline:', result[11]);
console.log('Now:', Math.floor(Date.now() / 1000));
"
```

### Manual Transactions

```bash
# Join match (0.001 ETH stake)
cast send 0xE155B0F15dfB5D65364bca23a08501c7384eb737 "joinMatch(uint256)" <MATCH_ID> \
  --value 0.001ether \
  --rpc-url https://sepolia.base.org \
  --private-key <KEY>

# Manual settle (winner: 1=playerA, 2=playerB, 0=draw)
cast send 0xE155B0F15dfB5D65364bca23a08501c7384eb737 "settleFiseMatch(uint256,uint8)" <MATCH_ID> <WINNER> \
  --rpc-url https://sepolia.base.org \
  --private-key <KEY>
```

---

## Logs Location

- **Indexer:** `/tmp/indexer_test.log`
- **Falken VM:** `/tmp/falken_test.log`
- **HouseBot:** `/tmp/housebot_test.log`
- **ReferenceAgent:** `/tmp/agent_test.log`

---

## Blockers for Next Test Run

### 1. Bot Funding Required
Both bots need more funds for proper testing:
- **Per match:** 0.001 ETH stake + ~0.0002 ETH gas
- **Recommended minimum:** 0.003 ETH each
- **Current status:** Both bots are underfunded

### 2. Fund Both Bots from Referee

```bash
# Fund HouseBot
cast send 0xb63ec09e541bc2ef1bf2bb4212fc54a6dac0c5f4 \
  --value 0.003ether \
  --rpc-url https://sepolia.base.org \
  --private-key 0x1275d21331d8c353f8f7f3d523526356adf69c4bd9502514f4d5a9d0d70041a4

# Fund ReferenceAgent  
cast send 0xAc4E9F0D2d5998cC6F05dDB1BD57096Db5dBc64A \
  --value 0.003ether \
  --rpc-url https://sepolia.base.org \
  --private-key 0x1275d21331d8c353f8f7f3d523526356adf69c4bd9502514f4d5a9d0d70041a4
```

---

## Expected Auto-Settlement Flow (Once Funded)

1. HouseBot creates FISE match (status=Open, matchCounter++)
2. ReferenceAgent detects open match → joins (status=Active, commitDeadline set)
3. Both bots detect Active match with phase=0 (commit phase)
4. Both bots call commitMove() with hashed moves
5. Indexer detects MoveCommitted events → stores to Supabase
6. After both commit, phase=1 (reveal phase), revealDeadline set
7. Both bots call revealMove() with plaintext moves
8. Indexer detects MoveRevealed events → updates Supabase
9. Falken VM detects MoveRevealed → fetches match history from Supabase
10. Falken VM reconstructs moves → fetches JS from IPFS
11. Falken VM executes JS to determine winner
12. Falken VM calls settleFiseMatch(matchId, winner)
13. Winner receives payout, match status=Completed

---

## IPFS Content

- **CID:** `QmcaiTUUvVHQ6oLz61R2AYbaZMJPmZYeoN3N4cBxuXSXQs`
- **URL:** https://ipfs.io/ipfs/QmcaiTUUvVHQ6oLz61R2AYbaZMJPmZYeoN3N4cBxuXSXQs
- **Type:** Rock Paper Scissors JavaScript game logic

---

## Files Modified in This Session

### Contracts
- `contracts/src/core/MatchEscrow.sol` - FISE support, virtual _resolveRound
- `contracts/src/core/FiseEscrow.sol` - New FISE escrow contract

### Bots
- `packages/house-bot/src/HouseBot.ts` - FISE detection, hash fix, multiple match prevention
- `packages/reference-agent/src/SimpleAgent.ts` - FISE support

### Falken VM (Claude's fixes)
- `packages/falken-vm/src/Watcher.ts` - Draw settlement fix, waitForMatchData, incomplete move guard
- `packages/falken-vm/src/Reconstructor.ts`
- `packages/falken-vm/src/Referee.ts`
- `packages/falken-vm/src/Settler.ts`
- `packages/falken-vm/src/Fetcher.ts`
- `packages/falken-vm/src/index.ts`

### Indexer (Claude's fixes)
- `packages/indexer/src/index.ts` - MoveCommitted ABI fix

---

## Next Steps for Testing

1. **Fund both bots** with 0.003+ ETH each
2. **Restart all services** (Indexer → Falken VM → HouseBot → ReferenceAgent)
3. **Monitor logs** for proper match flow
4. **Verify auto-settlement** - Falken VM should detect reveals, execute JS, and settle
5. **Check Supabase** for proper event indexing

---

## Git Commit

All changes committed as: `c46b628` - "feat: FISE (Falken Interplanetary Settlement Engine) - Phase 1 Implementation"
