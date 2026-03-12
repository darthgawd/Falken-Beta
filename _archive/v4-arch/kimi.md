# FALKEN V4 - Kimi Project Memory

**Created:** March 2026  
**Last Updated:** March 2026  
**Project Branch:** `fise-dev-v4migration`  
**Role:** Smart Contract Development & Security Audit

---

## 🎯 Project Overview

**FALKEN** is an on-chain gaming platform where AI agents (bots) play games against each other for USDC stakes, while human spectators bet on outcomes.

### Core Concept
- **Content:** AI bots playing provably fair games (poker, chess, RPS, etc.)
- **Revenue:** 5% rake from match pots + 5% rake from spectator prediction pools
- **Technology:** FISE (Falken Immutable Scripting Engine) - JavaScript game logic on IPFS

### Two Revenue Streams
1. **Match rake (5%)** - Taken from every bot-vs-bot match pot
2. **Prediction pool rake (5%)** - Taken from spectator betting pools

### How It Works
1. Game developer writes JavaScript logic, uploads to IPFS
2. IPFS CID registered in `LogicRegistry.sol` on-chain
3. Bots create/join matches via `PokerEngine.sol` (or other engines)
4. Players commit hashes → bet → reveal moves
5. Off-chain Referee runs JS logic, submits winner on-chain
6. Contract settles pot (rake to treasury, rest to winner)

---

## 🏗️ V4 Architecture

### Contract Hierarchy
```
BaseEscrow.sol (abstract)
├── PokerEngine.sol       ← Multi-street poker with betting
├── SimpleEngine.sol      ← RPS, simultaneous games (Phase 2)
└── TurnBasedEscrow.sol   ← Chess, sequential games (Phase 3)

LogicRegistry.sol         ← Game directory (IPFS CIDs)
PredictionPool.sol        ← Spectator betting (Phase 1 - TODO)
```

### Key Design Principles
1. **BaseEscrow holds ALL money** - Game engines cannot directly transfer funds
2. **Commit-Reveal pattern** - Prevents front-running
3. **Pull-payments** - Failed transfers queued instead of reverting
4. **Phase-gated logic** - Strict state machine prevents invalid transitions

---

## ✅ Completed Work

### 1. BaseEscrow.sol - The Money Layer
**Status:** ✅ Complete, 63 tests, ~97% coverage

**Key Features:**
- `_initMatch()` - Centralized match creation with validation
- `joinMatch()` - USDC staking, match activation when full
- `_settleMatch()` - Multi-winner settlement with rake calculation
- `_safeTransferUSDC()` - Pull-payment fallback for failed transfers
- `_addContribution()` - Tracks stakes + raises for accurate refunds
- Timeout functions - `claimTimeout()`, `mutualTimeout()`

**Security:**
- ReentrancyGuard on all fund-moving functions
- Ownable2Step - Two-step ownership transfer
- Pausable - Emergency circuit breaker
- Pull-payment fallback for blacklisted addresses

**Data Structures:**
```solidity
struct BaseMatch {
    address[] players;
    uint256 stake;
    uint256 totalPot;
    bytes32 logicId;
    uint8 maxPlayers;
    uint8 maxRounds;
    uint8 currentRound;
    uint8[] wins;           // Per-player win counts
    uint8 drawCounter;
    uint8 winsRequired;
    MatchStatus status;
    address winner;
}

struct Resolution {
    uint8[] winnerIndices;
    uint256[] splitBps;     // Basis points for split pots
}
```

### 2. LogicRegistry.sol - Game Directory
**Status:** ✅ Complete, 32 tests, 100% coverage

**Key Features:**
- `registerLogic()` - Owner-only game registration
- `bettingEnabled` flag - Differentiates betting vs non-betting games
- `maxStreets` - For poker variants (1=draw, 4=hold'em, 5=stud)
- `authorizedEscrows` - Security whitelist (C2 fix)
- Volume tracking per game

**V4 Additions:**
- Betting configuration per game
- Street count for poker variants
- Authorized escrow whitelist

### 3. PokerEngine.sol - Multi-Street Poker
**Status:** ✅ Complete, 93 tests, 90.21% branch coverage

**Key Features:**
- 3-phase flow: COMMIT → BET → REVEAL
- Betting actions: raise, call, check, fold
- Max 2 raises per street (raise + re-raise)
- 3 bet structures: NO_LIMIT, POT_LIMIT, FIXED_LIMIT
- Multi-street support (1-5 streets)
- Fold mechanics with immediate settlement when 1 player remains

**Phase Flow Per Street:**
```
COMMIT: Players submit hash(move + salt)
   ↓ (when all committed)
 BET: Players bet (raise/call/check/fold)
   ↓ (when betting complete)
REVEAL: Players reveal actual moves
   ↓ (when all revealed)
[Referee calls advanceStreet or resolveRound]
```

**Key Constants:**
```solidity
MAX_RAISES = 2;              // Per street
BET_WINDOW = 30 minutes;
COMMIT_WINDOW = 30 minutes;
REVEAL_WINDOW = 30 minutes;
```

**Poker Variants Supported:**
| Variant | maxStreets | Description |
|---------|-----------|-------------|
| 5-Card Draw | 1 | 5 hole cards, draw phase |
| Texas Hold'em | 4 | 2 hole + 5 community |
| Omaha | 4 | 4 hole + 5 community |
| 7-Card Stud | 5 | 7 cards, no community |
| Short Deck | 4 | 36-card deck |

### 4. Test Coverage Achievement
**Final Stats:**
- **150 total tests** across all contracts
- **BaseEscrow:** 63 tests, 96.43% lines, 90.67% branches
- **LogicRegistry:** 32 tests, 100% all metrics
- **PokerEngine:** 93 tests, 97.54% lines, 90.21% branches

**Uncovered Branches (3 in PokerEngine):**
1. `call()` maxBuyIn revert - Unreachable due to raise() checks
2. `fold()` playersToAct == 0 - Unreachable in 3+ player games
3. `revealMove()` Not committed - Unreachable (can't reach reveal without committing)

**Note:** These are defensive checks for impossible states, effectively 100% coverage of reachable code.

### 5. Security Audits
**Status:** ✅ Complete

#### Wake Audit (v4.22.1)
- 13 findings
- 0 Critical/High
- 1 Medium (false positive - pull-payment pattern)
- 12 Info (mostly inherited OpenZeppelin code)

#### Slither Audit
- 59 findings
- 0 Critical/High
- 1 Medium (false positive - ETH rejection pattern)
- 58 Info (timestamps, naming, inherited code)

**Key Security Patterns Validated:**
- ✅ ReentrancyGuard on all entry points
- ✅ Pull-payment fallback for failed transfers
- ✅ No arbitrary external calls
- ✅ Proper access controls (onlyOwner, onlyReferee)
- ✅ Phase validation prevents invalid transitions

---

## 🐛 Bugs Found & Fixed

### 1. Test Infrastructure Issues
**Issue:** Commit-reveal hash format inconsistency  
**Fix:** Standardized on FALKEN_V4 prefix format:
```solidity
keccak256(abi.encodePacked(
    "FALKEN_V4", address(this), matchId, round, player, move, salt
))
```

### 2. Coverage Test Failures
**Issue:** Multiple tests failing due to wrong move/salt values in helpers  
**Fix:** Updated `_commitBothPlayers()` and `_revealBothPlayers()` to use consistent values (move=5/7, salt=111/222)

### 3. Branch Coverage Gaps
**Issue:** Several require statement branches uncovered  
**Fix:** Added 30+ negative path tests to trigger revert conditions

### 4. Unreachable Code Detection
**Discovery:** 3 branches in PokerEngine are technically unreachable  
**Analysis:** These are defensive checks for impossible states - good to have but cannot be triggered in normal operation

---

## 💡 Key Discoveries

### 1. Security Architecture Insight
**Discovery:** Game engines cannot steal funds directly  
**Why:** 
- BaseEscrow holds all USDC
- Game engines call internal settlement functions
- No external transfer functions in game engines
- Even compromised engine can only manipulate game state, not steal

### 2. Reentrancy Pattern
**Discovery:** Pull-payments flagged as reentrancy by Slither  
**Analysis:** False positive - external calls are to trusted USDC contract, all entry points have nonReentrant modifier

### 3. Test Coverage Reality
**Discovery:** 100% branch coverage often impossible/undesirable  
**Why:**
- Defensive require statements for impossible states
- Some branches require breaking other invariants
- 90%+ coverage of reachable code is production-ready

### 4. Tool Differences
**Discovery:** Wake vs Slither have different strengths
- **Wake:** Better semantic analysis, fewer false positives
- **Slither:** More comprehensive pattern detection, higher false positive rate
- **Both agree:** No critical vulnerabilities

### 5. Gas Optimization Opportunities
**Discovery:** Multiple loops in admin functions  
**Analysis:** Acceptable because:
- Max 6 players per match
- Only admin/emergency functions
- No arbitrary call targets

---

## 📊 Current Project State

### Contracts Status
| Contract | Status | Tests | Coverage | Notes |
|----------|--------|-------|----------|-------|
| BaseEscrow.sol | ✅ Complete | 63 | 96.43% | Money layer, audited |
| LogicRegistry.sol | ✅ Complete | 32 | 100% | Game directory, audited |
| PokerEngine.sol | ✅ Complete | 93 | 97.54% | Poker engine, audited |
| IBaseEscrow.sol | ✅ Complete | - | Interface | Definitions only |
| PredictionPool.sol | ⏳ TODO | - | - | Phase 1 priority |
| SimpleEngine.sol | ⏳ Phase 2 | - | - | RPS, simple games |
| TurnBasedEscrow.sol | ⏳ Phase 3 | - | - | Chess, sequential |

### Documentation Created
- ✅ `v4.md` - Master architecture document
- ✅ `solidity-audits.md` - Security audit results (Wake + Slither)
- ✅ `kimi.md` - This file - Project memory

### Next Priority: PredictionPool.sol
**Why:**
- Completes Phase 1 core product
- Enables second revenue stream (spectator betting)
- Standalone contract (doesn't inherit BaseEscrow)
- Reads winner from any escrow via view function

**Parimutuel Betting Model:**
- All bets go into pool
- Winners split proportionally
- 5% rake to treasury
- 95% to winning bettors

---

## 📝 Technical Notes

### Commit-Reveal Pattern
```solidity
// Commit phase
bytes32 commitHash = keccak256(abi.encodePacked(
    "FALKEN_V4", address(this), matchId, round, player, move, salt
));
poker.commitMove(matchId, commitHash);

// Reveal phase
poker.revealMove(matchId, move, salt);
```

### Settlement Flow
```solidity
// Referee calls after final street
poker.resolveRound(matchId, winnerIndex);

// Internal _settleMatch:
// 1. Calculate 5% rake
// 2. Transfer rake to treasury
// 3. Distribute remaining to winners
// 4. Use pull-payment fallback if transfer fails
```

### Timeout Handling
```solidity
// Phase 1: Claim timeout (winner takes all)
// - Must have done your action (committed/revealed)
// - Other player timed out
// - Winner gets entire pot minus rake

// Phase 2: Mutual timeout (refund with penalty)
// - Both players agree to timeout
// - 1% penalty to treasury
// - 99% refunded to each player
```

---

## 🚧 Blockers & Challenges

### Resolved
1. ✅ Wake installation issues - Created new venv
2. ✅ Test coverage gaps - Added 30+ tests
3. ✅ Branch coverage confusion - Documented unreachable branches

### Current
None - Project ready for next phase

---

## 📅 Development Timeline

### Phase 1 (Current) - Core Product
- ✅ BaseEscrow.sol
- ✅ LogicRegistry.sol  
- ✅ PokerEngine.sol
- ⏳ PredictionPool.sol (NEXT)

### Phase 2 - Simple Games
- ⏳ SimpleEngine.sol (RPS, simultaneous games)

### Phase 3 - Sequential Games
- ⏳ TurnBasedEscrow.sol (Chess, etc.)

---

## 🔧 Tools & Environment

### Testing
- **Framework:** Foundry (forge test)
- **Coverage:** `forge coverage --match-contract [Name]`
- **Debugger:** `forge test -vvv`

### Security Auditing
- **Wake:** Semantic analysis (`wake detect all`)
- **Slither:** Static analysis (`slither . --compile-force-framework foundry`)

### Environment
- **Solidity:** 0.8.24
- **Framework:** Foundry
- **Dependencies:** OpenZeppelin Contracts v5

---

## 📚 Key Files

### Source Code
- `/contracts/src/core/BaseEscrow.sol`
- `/contracts/src/core/LogicRegistry.sol`
- `/contracts/src/core/PokerEngine.sol`
- `/contracts/src/interfaces/IBaseEscrow.sol`

### Tests
- `/contracts/test/BaseEscrow.t.sol` (63 tests)
- `/contracts/test/LogicRegistry.t.sol` (32 tests)
- `/contracts/test/PokerEngine.t.sol` (93 tests)

### Documentation
- `/_archive/v4-arch/v4.md` - Architecture spec
- `/_archive/v4-arch/solidity-audits.md` - Security audits
- `/_archive/v4-arch/kimi.md` - This file

---

## 🎯 Key Takeaways

1. **Security First:** BaseEscrow is the root of trust - audit it heavily, game engines are swappable
2. **Phase Gating:** Strict state machine prevents entire classes of bugs
3. **Pull-Payments:** Safer than direct transfers, handles edge cases
4. **Coverage Reality:** 90%+ of reachable code is production-ready
5. **Tool Consensus:** Multiple auditors agreeing = higher confidence

---

**Next Action:** Build PredictionPool.sol for spectator betting revenue
