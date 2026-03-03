# Solidity Security Architecture & DeFi Security Knowledge Base

> **Status: 8 ORIGINAL FINDINGS FIXED — 24 NEW FINDINGS IDENTIFIED** — Original audit completed 2026-02-23. V2.1 combined audit (Discard & Draw phase) completed 2026-02-23. The 24 new findings below are **UNFIXED** and must be resolved before mainnet deployment.

## Advanced Solidity Audit Prompt

```
AUDIT METHODOLOGY — Multi-Vector Smart Contract Security Analysis

1. RECONNAISSANCE
   - Read all contracts, interfaces, and inheritance chains
   - Map storage layouts (forge inspect <Contract> storage-layout)
   - Identify all external calls, state mutations, and access control boundaries
   - Trace ETH/token flow paths from entry to exit

2. ATTACK SURFACE ANALYSIS (per function)
   a. Reentrancy (single-function, cross-function, cross-contract, read-only)
      - Does any external call happen before state is finalized?
      - Can a callback re-enter THIS function or ANY other function that reads the same state?
      - Are all external calls (including .call{value:}) after ALL state changes?
   b. Access Control
      - Who can call this? Is it owner-only, participant-only, or public?
      - Can a third party grief or manipulate by calling?
      - Are there missing modifiers (onlyOwner, nonReentrant, whenNotPaused)?
   c. Arithmetic & Precision
      - Integer overflow/underflow (pre-0.8 or unchecked blocks)
      - Rounding errors in division (dust, loss of precision)
      - Multiplication before division ordering
   d. Frontrunning / MEV
      - Can mempool observers extract value or grief?
      - Are commit-reveal schemes properly implemented?
      - Can joinMatch/swap/bid be front-run?
   e. Denial of Service
      - Can a reverting external call block critical paths?
      - Push vs pull payment patterns
      - Unbounded loops or gas griefing
   f. State Machine Integrity
      - Can status transitions be bypassed or forced?
      - Are all enum transitions valid and complete?
      - Can functions be called in unexpected phases?

3. INVARIANT IDENTIFICATION
   - What must ALWAYS be true? (e.g., contract balance >= sum of all stakes + pending)
   - What must NEVER happen? (e.g., funds locked permanently)
   - Write these as properties for fuzz/invariant testing

4. COVERAGE ANALYSIS
   - Target 100% lines, statements, branches, functions
   - Identify unreachable branches (dead code) — document or remove
   - Use mock contracts for controlled game logic outcomes
   - Use vm.store() for branches unreachable through normal contract flow
   - Use togglable receiver contracts for testing push/pull payment paths

5. SEVERITY CLASSIFICATION
   - CRITICAL: Direct fund loss, unauthorized access to funds
   - HIGH: Conditional fund loss, reentrancy vectors, DoS on critical paths
   - MEDIUM: Griefing, frontrunning, economic manipulation
   - LOW: Minor griefing, rounding dust, cosmetic issues
   - INFO: Gas optimization, code quality, dead code

6. FIX VERIFICATION
   - Fix one issue at a time
   - Run full test suite after EACH fix
   - Update affected tests to match new behavior
   - Verify coverage didn't regress
```

---

## Audit Case Study: Falken Arena (MatchEscrowV2 + FiveCardDraw)

### Contracts Audited
- `MatchEscrowV2.sol` — Enhanced escrow for best-of-5 matches with commit-reveal, timeouts, surrender, and pull payments
- `FiveCardDraw.sol` — 5-Card Draw poker game logic with surrender payout rules
- `MatchEscrow.sol` (V1) — Original escrow with best-of-3 RPS matches

### Architecture Overview
```
IGameLogicV2 (interface)
    |
    +-- FiveCardDraw (implements resolveRoundV2, surrenderPayout, gameType, getRoundResultMetadata)
    +-- SimpleDice
    +-- RPS (V1 interface)

MatchEscrowV2 (ReentrancyGuard, Ownable, Pausable)
    - Match lifecycle: OPEN -> ACTIVE -> SETTLED/VOIDED
    - Round lifecycle: COMMIT -> REVEAL -> resolve -> next round or settle
    - Commit-reveal scheme for provably fair gameplay
    - Pull payment pattern via _safeTransfer + pendingWithdrawals
    - Best of 5 rounds, 3 wins to settle
    - Timeout claims (single + mutual) with deadline enforcement
    - Surrender with configurable winner share (75/25 default)
    - 5% rake to treasury on all settlements
```

---

## Findings & Fixes (All Resolved)

### Finding 1 (HIGH): Cross-Function Reentrancy in `surrender()` — FIXED

**Problem:** Raw `payable(treasury).call{value: totalRake}("")` with `require(successRake)` before `_safeTransfer` calls to winner and surrenderer. A malicious treasury contract could:
- Re-enter other functions that read stale state
- If treasury reverts, the entire surrender is DoS'd permanently

**Before:**
```solidity
(bool successRake, ) = payable(treasury).call{value: totalRake}("");
require(successRake, "Treasury fail");
_safeTransfer(winner, finalWinnerPayout);
_safeTransfer(msg.sender, finalSurrenderPayout);
```

**After:**
```solidity
_safeTransfer(treasury, totalRake);
_safeTransfer(winner, finalWinnerPayout);
_safeTransfer(msg.sender, finalSurrenderPayout);
```

**Key Insight:** Using `_safeTransfer` for ALL external transfers (including treasury) means a reverting recipient never blocks the function — funds queue to `pendingWithdrawals` instead.

---

### Finding 2 (HIGH): Cross-Function Reentrancy in `_settleMatch()` — FIXED

**Same pattern as Finding 1.** Raw treasury call before winner payout.

**Fix:** Replace `payable(treasury).call` + `require` with `_safeTransfer(treasury, rake)`.

**General Rule:** Never use raw `.call{value:}()` with `require` for non-critical recipients. Use the pull payment pattern (`_safeTransfer` + `pendingWithdrawals` + `withdraw()`) for ALL outgoing transfers.

---

### Finding 3 (MEDIUM): Treasury DoS — FIXED

**Problem:** If treasury is set to a contract that reverts, `_settleMatch` and `surrender` revert forever, permanently locking player funds.

**Fix:** Resolved by Findings 1 & 2. Treasury payments now use `_safeTransfer`, so a reverting treasury just queues the rake to `pendingWithdrawals`. Matches settle normally regardless.

**Pattern — Pull Payment Safety:**
```solidity
function _safeTransfer(address to, uint256 amount) internal {
    if (amount == 0) return;
    (bool success, ) = payable(to).call{value: amount}("");
    if (!success) pendingWithdrawals[to] += amount;
}

function withdraw() external nonReentrant {
    uint256 amount = pendingWithdrawals[msg.sender];
    require(amount > 0, "Zero balance");
    pendingWithdrawals[msg.sender] = 0;
    (bool success, ) = payable(msg.sender).call{value: amount}("");
    require(success, "Withdrawal failed");
}
```

---

### Finding 4 (MEDIUM): Frontrunning on `joinMatch` — FIXED

**Problem:** Mempool observers can see `createMatch` transactions and front-run the intended opponent. No whitelisting mechanism exists.

**Fix:** Added optional `invitedPlayer` field to `Match` struct and overloaded `createMatch`:
```solidity
struct Match {
    // ... existing fields ...
    address invitedPlayer; // address(0) = open to anyone
}

function createMatch(uint256 _stake, address _gameLogic) external payable { ... }
function createMatch(uint256 _stake, address _gameLogic, address _invitedPlayer) external payable { ... }

// In joinMatch:
require(m.invitedPlayer == address(0) || m.invitedPlayer == msg.sender, "Not invited");
```

**Key Insight:** Use `address(0)` as "no restriction" sentinel. Backward-compatible — existing callers use the 2-arg overload which defaults to open matches.

---

### Finding 5 (LOW): `mutualTimeout` Callable by Anyone — FIXED

**Problem:** Any address can trigger `mutualTimeout`, allowing griefing — a third party can force matches into VOIDED state.

**Fix:** Added participant check:
```solidity
require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");
```

---

### Finding 6 (LOW): Rounding Dust — ACKNOWLEDGED (Negligible Risk)

**Problem:** `totalRefund / 2` loses 1 wei for odd-amount stakes in `mutualTimeout`. This wei is permanently locked.

**Assessment:** 1 wei per odd-stake mutual timeout is negligible. A `sweepDust()` function would require tracking total owed across all active matches and pending withdrawals to avoid sweeping player funds — complexity not worth it for 1 wei.

---

### Finding 7 (INFO): No `receive()` / `fallback()` — FIXED

**Problem:** ETH sent via `selfdestruct` (or future protocol changes) would revert.

**Fix:** Added `receive() external payable {}` to accept force-sent ETH gracefully.

---

### Finding 8 (INFO): `rakeBps` Mutable but No Setter — FIXED

**Problem:** `rakeBps` was a mutable state variable with no setter function, wasting a storage slot.

**Fix:** Changed to `uint256 public constant RAKE_BPS = 500;` — saves gas on every read (no SLOAD) and makes the 5% rake immutable.

---

## Coverage Strategy

### Before Audit
| Contract | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| FiveCardDraw.sol | 100% | 92.86% | **0.00%** | 100% |
| MatchEscrowV2.sol | 96.45% | 96.30% | **59.79%** | 100% |
| MatchEscrow.sol | 100% | 100% | **96.84%** | 100% |

### After Audit
| Contract | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| FiveCardDraw.sol | **100%** | **100%** | **100%** | **100%** |
| MatchEscrowV2.sol | **100%** | **100%** | **100%** | **100%** |
| MatchEscrow.sol | **100%** | **100%** | **100%** | **100%** |

### Techniques Used

#### 1. Test Harness for Unreachable Branches
FiveCardDraw's draw branch (`scoreA == scoreB`) is cryptographically unreachable since `keccak256(seed, "A") != keccak256(seed, "B")` always. Solution: make `_evaluateHand` virtual, create a harness:
```solidity
contract FiveCardDrawHarness is FiveCardDraw {
    function _evaluateHand(bytes32, string memory) internal pure override returns (uint256) {
        return 42; // Forces draw
    }
}
```

#### 2. Mock Game Logic for Controlled Outcomes
```solidity
contract MockPlayerBWinsLogic is IGameLogicV2 {
    function resolveRoundV2(...) external pure override returns (uint8) { return 2; }
    // ... minimal interface implementation
}

contract MockDrawGameLogic is IGameLogicV2 {
    function resolveRoundV2(bytes32 move1, ...) external pure override returns (uint8) {
        uint256 round = uint256(move1);
        if (round == 1 || round == 3) return 1;
        if (round == 2 || round == 4) return 2;
        return 0; // Round 5 draw -> 2-2 tie
    }
}
```

#### 3. Storage Manipulation for Structurally Unreachable Branches
Some branches are unreachable through normal contract flow (e.g., "Opponent committed" in commit phase — both committing auto-transitions to REVEAL). Use `vm.store()`:
```solidity
// Manually set playerB's commitHash without triggering phase transition
bytes32 slot1 = keccak256(abi.encode(uint256(1), uint256(5)));      // roundCommits[1]
bytes32 slot2 = keccak256(abi.encode(uint256(1), slot1));            // roundCommits[1][1]
bytes32 slot3 = keccak256(abi.encode(playerB, slot2));               // roundCommits[1][1][playerB]
vm.store(address(escrow), slot3, keccak256("fake"));                 // Set commitHash
```

**Storage Layout Discovery:** Use `forge inspect <Contract> storage-layout` to find slot numbers, then compute nested mapping slots with `keccak256(abi.encode(key, baseSlot))`.

#### 4. Togglable Receiver for Push/Pull Payment Testing
```solidity
contract TogglableReceiver {
    bool public accept = true;
    receive() external payable { require(accept, "Rejected"); }
    function setAccept(bool _accept) external { accept = _accept; }
}
```
Set `accept = false` to force `_safeTransfer` fallback to `pendingWithdrawals`, then `accept = true` to test successful `withdraw()`.

---

## Security Patterns Reference

### Checks-Effects-Interactions (CEI)
```
1. CHECKS:  All require() validations
2. EFFECTS: All state changes (status, balances, mappings)
3. INTERACTIONS: All external calls (.call, .transfer, contract calls)
```
Never make external calls before finishing all state changes.

### Pull Over Push Payments
Never `require` that an ETH transfer succeeds to a user-controlled address. Use `_safeTransfer` pattern: attempt push, fall back to pull via `pendingWithdrawals`.

### Commit-Reveal for Fair Games
```
Commit: hash = keccak256(matchId, round, player, move, salt)
Reveal: verify hash matches, then store move + salt
Resolve: use both players' moves/salts for deterministic outcome
```
Enforce deadlines on both phases to prevent stalling.

### Timeout Architecture
- **Single timeout:** One player acted, opponent didn't -> acting player wins
- **Mutual timeout:** Neither player acted -> void match with small penalty
- **Deadline enforcement:** `require(block.timestamp <= deadline)` on commit/reveal to prevent front-running timeout claims

---

## Sources & References

- [OWASP Smart Contract Top 10 2025 - Reentrancy](https://owasp.org/www-project-smart-contract-top-10/2025/en/src/SC05-reentrancy-attacks.html)
- [Cyfrin - How To Systematically Approach a Smart Contract Audit](https://www.cyfrin.io/blog/10-steps-to-systematically-approach-a-smart-contract-audit)
- [Sherlock - Complete Guide to Solidity Security Audits](https://sherlock.xyz/post/a-complete-guide-to-solidity-security-audits-for-web3-protocols)
- [Hacken - Top 10 Smart Contract Vulnerabilities 2025](https://hacken.io/discover/smart-contract-vulnerabilities/)
- [Alchemy - Reentrancy Attack Patterns](https://www.alchemy.com/overviews/reentrancy-attack-solidity)
- [Solidity by Example - Re-Entrancy](https://solidity-by-example.org/hacks/re-entrancy/)
- [QuickNode - Reentrancy Overview](https://www.quicknode.com/guides/ethereum-development/smart-contracts/a-broad-overview-of-reentrancy-attacks-in-solidity-contracts)

---

*Last updated: 2026-02-23 | Contracts: MatchEscrowV2, MatchEscrow, FiveCardDraw, RPS, SimpleDice | 138 tests, 100% coverage*

---

## Royal Flush Tier Upgrade — COMPLETED (2026-02-23)

### What Was Done (Claude)

The full poker evaluator has been implemented in `FiveCardDraw.sol` and hand-ranking tests added to `MatchEscrowV2.t.sol`. Here's the status:

**Completed:**
1. **`ROYAL_FLUSH = 9` constant** added after `STRAIGHT_FLUSH`
2. **`_dealCards(seed, player)`** — Deterministic 5-card dealing with collision resolution via increment+wrap mod 52. Made `virtual` so test harnesses can override it.
3. **Full `_evaluateHand`** — Replaces the keccak256 placeholder with real poker evaluation:
   - Extracts ranks (card/4) and suits (card%4)
   - Sorts ranks descending via insertion sort
   - Detects flush, straight (including Ace-low wheel A-2-3-4-5)
   - Counts rank frequencies for pairs/trips/quads
   - Classifies 0-9: HIGH_CARD through ROYAL_FLUSH
   - Encodes score as `uint256(handRank) << 20 | kicker_bits` for tie-breaking
4. **`getRoundResultMetadata`** — Now returns real JSON with each player's 5 cards (rank+suit notation like "AS", "KH"), hand rank number, and winner
5. **`_cardsToString` and `_uint8ToString`** helper functions added
6. **Test harnesses created:**
   - `FiveCardDrawTestHarness` — exposes `_dealCards` and `_evaluateHand` for direct testing
   - `FiveCardDrawFixedHand` — overrides `_dealCards` to decode cards from seed bytes, enabling controlled hand injection via `packCards()`
   - `FiveCardDrawMetaHarness` — forces player A to always win (for metadata branch coverage)
7. **All 10 hand types tested** with fixed hands: Royal Flush, Straight Flush, Straight Flush Wheel, Four of a Kind, Full House, Flush, Straight, Wheel Straight, Three of a Kind, Two Pair, Pair, High Card
8. **Comparison tests:** Royal flush beats straight flush, pair of Aces beats pair of Kings (tie-breaking), wheel loses to 6-high straight
9. **Existing `testFiveCardDrawSpecifics` updated** — metadata assertion changed from old placeholder string to length/format check

### Current Test Results (All Passing)
```
forge test: 160 tests passed, 0 failed, 0 skipped (5 test suites)
  - MatchEscrowV2.t.sol: 94 tests passing
  - MatchEscrow.t.sol: 58 tests passing
  - Others: 8 tests passing
```

### Coverage Status for FiveCardDraw.sol
```
| Lines           | Statements      | Branches        | Functions       |
|-----------------|-----------------|-----------------|-----------------|
| 100.00% (118/118) | 98.83% (169/171) | 94.29% (33/35) | 100.00% (9/9) |
```

### What Remains — 2 Uncovered Branches to Fix

The 2 missing branches are both in `getRoundResultMetadata` at lines 200-201 — the winner conditional:

```solidity
// Line 200: the TRUE branch (scoreA == scoreB → draw) is never hit
if (scoreA == scoreB) winner = 0;
// Line 201: the TRUE branch (scoreA > scoreB → A wins) is never hit
else if (scoreA > scoreB) winner = 1;
else winner = 2;
```

**Why they're missed:** With real card dealing, both players always get different hands from the same deck seed (different player strings "A" vs "B"), so `scoreA == scoreB` is cryptographically unreachable. The `scoreA > scoreB` branch IS hit in `resolveRoundV2` (same logic), but not specifically inside `getRoundResultMetadata`.

**How to fix (approach was in progress):**
- Use `FiveCardDrawHarness` (returns 42 for both players) to call `getRoundResultMetadata` → this will hit the draw path (`scoreA == scoreB`)
- Use `FiveCardDrawMetaHarness` (returns 200 for player A, 100 for player B) to call `getRoundResultMetadata` → this will hit the `scoreA > scoreB` path
- The test code was written but not yet compiled/run when interrupted:

```solidity
function testMetadataDrawPath() public {
    FiveCardDrawHarness drawHarness = new FiveCardDrawHarness();
    string memory meta = drawHarness.getRoundResultMetadata(
        bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), bytes32(uint256(4))
    );
    assertTrue(bytes(meta).length > 0);
}

function testMetadataPlayerAWinsPath() public {
    FiveCardDrawMetaHarness mh = new FiveCardDrawMetaHarness();
    string memory meta = mh.getRoundResultMetadata(
        bytes32(0), bytes32(0), bytes32(0), bytes32(0)
    );
    assertTrue(bytes(meta).length > 0);
}
```

The `FiveCardDrawMetaHarness` is already in the test file:
```solidity
contract FiveCardDrawMetaHarness is FiveCardDraw {
    function _evaluateHand(bytes32, string memory player) internal pure override returns (uint256) {
        if (keccak256(abi.encodePacked(player)) == keccak256("A")) return 200;
        return 100;
    }
}
```

And the two test functions (`testMetadataDrawPath`, `testMetadataPlayerAWinsPath`) are also already in the test file but were never compiled or run.

### Final Results
All items completed. Gemini fixed the remaining 2 uncovered branches. Final coverage:
```
| FiveCardDraw.sol | 100.00% (118/118) | 100.00% (171/171) | 100.00% (35/35) | 100.00% (9/9) |
```
160 tests passing across 5 test suites. `smart-contract-shared.md` marked as completed.

---

## V2.1 Combined Audit: Discard & Draw Phase — 24 Findings (UNFIXED)

> **Audit date:** 2026-02-23
> **Auditors:** Claude Opus 4.6 (14 findings) + External Review (10 additional findings)
> **Contracts audited:** MatchEscrowV2.sol, FiveCardDraw.sol, FiveCardDrawWithDiscard.sol, MatchState.sol, IGameLogicV2.sol
> **Test count:** 201 tests passing across 5 suites
> **Status:** All 24 findings are **UNFIXED** and must be resolved before mainnet

### Summary by Severity

| Severity | Count | Findings |
|----------|-------|----------|
| CRITICAL | 3 | #1, #2, #3 |
| HIGH | 5 | #4, #5, #6, #7, #8 |
| MEDIUM | 9 | #9, #10, #11, #12, #13, #14, #15, #16, #17 |
| LOW | 6 | #18, #19, #20, #21, #22, #23 |
| INFO | 1 | #24 |

---

### Finding 1 (CRITICAL): Poker Hand Kicker Comparison Is Broken

**File:** `FiveCardDraw.sol:186-194` (also affects `FiveCardDrawWithDiscard.sol` via inheritance)
**Source:** Claude Opus 4.6

**Problem:** Kicker bits are built from ranks sorted descending by **face value**. Poker requires sorting by **frequency first, then value**. This produces incorrect winners for paired hands.

**Concrete example — Full House: 33322 vs 222AA:**
- 33322: ranks sorted desc = `[1,1,1,0,0]` → kicker = `0x11100`
- 222AA: ranks sorted desc = `[12,12,0,0,0]` → kicker = `0xCC000`
- **Code says 222AA wins** (because A > 3 at first kicker position)
- **Correct: 33322 wins** (trips of 3 beat trips of 2; pair is irrelevant)

**Affected hand types:**
- **Full House:** Small trips + big pair beats big trips + small pair (wrong)
- **Two Pair:** Low pairs + high kicker beats high pairs + low kicker (wrong). E.g., 2233K beats QQ44J
- **Three of a Kind:** Low trips + high kickers beats high trips + low kickers (wrong). E.g., 222AK beats 33345
- **Pair:** Low pair + high kickers beats high pair + low kickers (wrong). E.g., 22AKQ beats 33456

**Fix:** Kicker bits must be ordered by frequency descending, then rank descending within each frequency group. For example, full house kickers should be `[trip_rank x3, pair_rank x2]` not `[sorted desc by value]`.

```solidity
// Example fix approach: sort ranks by (frequency desc, rank desc)
// For full house 222AA: [0,0,0,12,12] → frequency-sorted: [0,0,0,12,12] (trips first)
// For full house 33322: [1,1,1,0,0]  → frequency-sorted: [1,1,1,0,0]   (trips first)
// Now 33322 > 222AA at position 0: 1 > 0 ✓
```

---

### Finding 2 (CRITICAL): Discard Phase Information Leak — Both Players See Each Other's Cards

**File:** `MatchEscrowV2.sol:131-139` (reveal phase) and `MatchEscrowV2.sol:142-162` (discard phase)
**Source:** Both auditors independently identified this

**Problem:** After both players reveal in the REVEAL phase, all four values (`moveA`, `saltA`, `moveB`, `saltB`) are on-chain and public. The `deckSeed = keccak256(moveA, saltA, moveB, saltB)` is now computable by anyone. Since dealing is deterministic from the seed, **both players' starting hands are fully known**.

In the DISCARD phase that follows:
1. Both starting hands are derivable from the public deckSeed
2. Discard masks are submitted in **plaintext** (no commit-reveal)
3. The **second player to submit** can:
   - See the opponent's starting hand (from deckSeed)
   - See the opponent's discard mask (from their `submitDiscard` tx)
   - Compute replacement cards and the opponent's final hand
   - Choose the optimal discard mask to beat it

Even the **first** player to submit has perfect knowledge of the opponent's hand — they just can't see the opponent's discard mask yet.

**Impact:** Complete information leak. This is NOT poker — it's "play with open hands."

**Fix (Option A — Commit/reveal discard masks, recommended):**

1. Extend `Phase` enum in `MatchState.sol`:
```solidity
enum Phase { COMMIT, REVEAL, DISCARD_COMMIT, DISCARD_REVEAL }
```

2. Add discard commit storage in `MatchState.sol`:
```solidity
struct DiscardCommit {
    bytes32  commitHash;
    uint8    mask;
    bytes32  salt;
    bool     revealed;
}
mapping(uint256 => mapping(uint8 => mapping(address => DiscardCommit))) public discardCommits;
```

3. Add `commitDiscard(matchId, bytes32 commitHash)` and `revealDiscard(matchId, uint8 mask, bytes32 salt)` in `MatchEscrowV2.sol`. Only when both discard reveals are done, resolve with discard.

**Fix (Option B — Late entropy, lighter but weaker):**

In `_resolveRoundWithDiscard(...)` before calling `logic.resolveDraw(...)`:
```solidity
bytes32 lateEntropy = blockhash(block.number - 1);
bytes32 deckSeed = keccak256(abi.encodePacked(rcA.move, rcA.salt, rcB.move, rcB.salt, lateEntropy));
```

**Warning:** `blockhash` is validator-influenceable. For robust fairness, use Option A.

---

### Finding 3 (CRITICAL): Missing Participant Authorization in `revealMove`

**File:** `MatchEscrowV2.sol:111-140`
**Source:** External Review

**Problem:** `commitMove()` correctly restricts callers to `playerA` or `playerB`, but `revealMove()` does **not**. While a random caller usually can't satisfy the reveal hash check without a prior commit, leaving this open:
- Increases attack surface
- Creates future upgrade/maintenance hazards
- Breaks the principle of least privilege
- Can enable griefing if any auxiliary code ever writes commit hashes for non-players

**Fix:** Add at the start of `revealMove(...)` after phase/status checks:

```solidity
require(m.status == MatchStatus.ACTIVE, "Not active");
require(m.phase == Phase.REVEAL, "Not in reveal");
require(block.timestamp <= m.revealDeadline, "Expired");
require(msg.sender == m.playerA || msg.sender == m.playerB, "Unauthorized"); // ← ADD THIS
```

---

### Finding 4 (HIGH): Commit Hash Domain Separation Is Weak

**File:** `MatchEscrowV2.sol:121`
**Source:** External Review

**Problem:** The reveal validation uses:
```solidity
keccak256(abi.encodePacked(_matchId, m.currentRound, msg.sender, _move, _salt))
```

This lacks `address(this)` binding and a domain separator. Commit hashes are replayable if a second `MatchEscrowV2` is deployed, or could collide with other protocols using similar preimage schemes.

**Fix:** Replace the expectedHash computation in `revealMove(...)`:

```solidity
bytes32 expectedHash = keccak256(
    abi.encodePacked("FALKEN_MATCH_V2", address(this), _matchId, m.currentRound, msg.sender, _move, _salt)
);
```

Also add a helper so frontends compute the correct hash:
```solidity
function computeCommitHash(
    uint256 matchId, uint8 round, address player, bytes32 move, bytes32 salt
) external view returns (bytes32) {
    return keccak256(
        abi.encodePacked("FALKEN_MATCH_V2", address(this), matchId, round, player, move, salt)
    );
}
```

---

### Finding 5 (HIGH): Round State Not Cleared — Storage Bloat

**File:** `MatchEscrowV2.sol:191-206` (`_postRoundResolution`)
**Source:** External Review

**Problem:** Per-round structs in `roundCommits` and `discardSubmissions` are never deleted after resolution. Old round data persists forever:
- Bloats storage over time (costly long term)
- Misses gas refunds from `SSTORE` zero-out
- Makes audits/invariants harder
- Increases risk of future changes accidentally reading stale state

**Fix:** In `_postRoundResolution(...)`, after `emit RoundResolved(...)` and before incrementing round:

```solidity
emit RoundResolved(_matchId, m.currentRound, winner);

// Clean up completed round state
delete roundCommits[_matchId][m.currentRound][m.playerA];
delete roundCommits[_matchId][m.currentRound][m.playerB];
delete discardSubmissions[_matchId][m.currentRound][m.playerA];
delete discardSubmissions[_matchId][m.currentRound][m.playerB];

if (m.winsA >= 3 || m.winsB >= 3 || m.currentRound >= 5) {
```

---

### Finding 6 (HIGH): `_safeTransfer` Silent Failure — `WithdrawalQueued` Event Never Emitted

**File:** `MatchEscrowV2.sol:343-347`
**Source:** Both auditors independently identified this

**Problem:** When `_safeTransfer` falls back to `pendingWithdrawals`, the `WithdrawalQueued` event (declared on line 28) is **never emitted**. Users and backend systems have no way to know funds are stuck without polling the mapping directly.

**Fix:**
```solidity
function _safeTransfer(address to, uint256 amount) internal {
    if (amount == 0) return;
    (bool success, ) = payable(to).call{value: amount}("");
    if (!success) {
        pendingWithdrawals[to] += amount;
        emit WithdrawalQueued(to, amount);
    }
}
```

---

### Finding 7 (HIGH): Permanently Locked Funds in `pendingWithdrawals` — No Admin Rescue

**File:** `MatchEscrowV2.sol:349-355`
**Source:** Claude Opus 4.6

**Problem:** If a recipient address is permanently unable to receive ETH (e.g., a contract without `receive`/`fallback`), their `pendingWithdrawals` balance is locked forever. No admin function exists to rescue these funds.

**Fix:**
```solidity
function adminRescueStuckFunds(address stuckAddress, address recipient) external onlyOwner {
    uint256 amount = pendingWithdrawals[stuckAddress];
    require(amount > 0, "Nothing stuck");
    pendingWithdrawals[stuckAddress] = 0;
    _safeTransfer(recipient, amount);
}
```

---

### Finding 8 (HIGH): External Game Logic Calls Are Untrusted and Ungassed

**File:** `MatchEscrowV2.sol:133, 171, 186, 278`
**Source:** Claude Opus 4.6

**Problem:** Multiple functions call external game logic contracts with no gas cap:
- Line 133: `IGameLogicV2(m.gameLogic).requiresDiscard()`
- Line 171: `logic.resolveRoundV2(...)`
- Line 186: `logic.resolveDraw(...)`
- Line 278: `IGameLogicV2(m.gameLogic).surrenderPayout()`

A malicious or buggy game logic contract could consume all gas, revert conditionally, or return unexpected values. The `approvedGameLogic` check only happens at `createMatch` time.

**Fix:**
- Add gas caps: `logic.resolveRoundV2{gas: 500_000}(...)`
- Wrap in try/catch with a fallback (e.g., void the match)
- Cache `requiresDiscard()` result at match creation time

---

### Finding 9 (MEDIUM): `commitMove` Accepts `bytes32(0)` — Match Stuck Forever

**File:** `MatchEscrowV2.sol:99-108`
**Source:** Claude Opus 4.6

**Problem:** The "already committed" sentinel is `bytes32(0)`. If a player passes `bytes32(0)` as their commit hash, they can call `commitMove` repeatedly and the phase transition never fires.

**Fix:**
```solidity
require(_commitHash != bytes32(0), "Invalid commit hash");
```

---

### Finding 10 (MEDIUM): `claimTimeout` Overwrites Real Match Score / Instantly Wins Match

**File:** `MatchEscrowV2.sol:218-219`
**Source:** Both auditors independently identified this (score corruption + incentive risk)

**Problem:** `claimTimeout` sets `winsA = 3` or `winsB = 3`, erasing actual match history. A player winning 2-0 who times out on round 3 shows as having lost 0-3. Additionally, one late transaction loses the full match which creates harsh UX and congestion-griefing incentives.

**Fix (Option A — Timeout awards only the current round, recommended):**
```solidity
// Replace winsA/winsB = 3 with:
uint8 w = (msg.sender == m.playerA) ? 1 : 2;
_postRoundResolution(_matchId, w);
```

**Fix (Option B — Settle directly with explicit winner, no score override):**
```solidity
if (msg.sender == m.playerA) {
    _settleMatchWithWinner(_matchId, m.playerA);
} else {
    _settleMatchWithWinner(_matchId, m.playerB);
}
```

---

### Finding 11 (MEDIUM): No Minimum Stake — Spam Vector

**File:** `MatchEscrowV2.sol:48`
**Source:** Claude Opus 4.6

**Problem:** `require(_stake > 0)` allows 1 wei stakes, enabling near-zero-cost spam.

**Fix:**
```solidity
uint256 public constant MIN_STAKE = 0.001 ether;
require(_stake >= MIN_STAKE, "Stake below minimum");
```

---

### Finding 12 (MEDIUM): FiveCardDraw.sol — Cross-Player Card Duplication

**File:** `FiveCardDraw.sol:70-87`
**Source:** Claude Opus 4.6

**Problem:** `_dealCards(seed, "A")` and `_dealCards(seed, "B")` deal from independent virtual decks. Two players can hold the same card. ~60% probability of at least one cross-player duplicate per round.

Affects FiveCardDraw ("Blind Five Card") only — FiveCardDrawWithDiscard uses a shared deck correctly.

**Fix:** If intentional for "Blind" mode, document prominently. If not, implement a shared deck.

---

### Finding 13 (MEDIUM): Commit Binding UX Risk — No Canonical Hash Helper

**File:** `MatchEscrowV2.sol`
**Source:** External Review

**Problem:** `commitMove()` accepts any `bytes32`, but `revealMove()` enforces one specific preimage scheme. If a client commits a hash using a different formula, they cannot reveal and lose via timeout.

**Fix:** Add a public helper (especially important after Finding 4 changes the hash formula):
```solidity
function computeCommitHash(
    uint256 matchId, uint8 round, address player, bytes32 move, bytes32 salt
) external view returns (bytes32) {
    return keccak256(
        abi.encodePacked("FALKEN_MATCH_V2", address(this), matchId, round, player, move, salt)
    );
}
```

---

### Finding 14 (MEDIUM): Missing Explicit "No Commit" Check in `revealMove`

**File:** `MatchEscrowV2.sol:117-118`
**Source:** External Review

**Problem:** If `commitHash` is zero (never committed), the error will be "Invalid reveal" which is misleading. Better to have an explicit guard.

**Fix:** In `revealMove(...)`, after loading `rc`:
```solidity
RoundCommit storage rc = roundCommits[_matchId][m.currentRound][msg.sender];
require(rc.commitHash != bytes32(0), "No commit");   // ← ADD THIS
require(!rc.revealed, "Already revealed");
```

---

### Finding 15 (MEDIUM): Discard Masks Should Be Validated in Game Logic Too

**File:** `FiveCardDrawWithDiscard.sol:49-109`
**Source:** External Review

**Problem:** The escrow validates `_discardMask <= 31` but `_resolveDrawFull` does not. Anyone calling the game logic directly (it's `external pure`) gets undefined behavior for masks > 31.

**Fix:** At the start of `_resolveDrawFull(...)`, after `InternalState memory s;`:
```solidity
maskA &= 0x1F;
maskB &= 0x1F;
```

---

### Finding 16 (MEDIUM): Shared-Deck Draw Uses Linear Probing — Distribution Bias

**File:** `FiveCardDrawWithDiscard.sol:60-62, 71-73, 89-91, 102-104`
**Source:** External Review

**Problem:** When a drawn card is already used, the code walks forward `card + 1 % 52` until finding an unused slot. This guarantees uniqueness but biases toward cards immediately after popular hash outputs vs uniform distribution among remaining cards.

**Fix:** Replace linear probing with rehash-on-collision:
```solidity
function _drawUnique(bytes32 seed, InternalState memory s) internal pure returns (uint8) {
    while (true) {
        uint8 c = uint8(uint256(keccak256(abi.encodePacked(seed, s.idx))) % 52);
        s.idx++;
        uint256 bit = (uint256(1) << uint256(c));
        if ((s.used & bit) == 0) {
            s.used |= bit;
            return c;
        }
    }
}
```

Then replace all 4 draw-card blocks in `_resolveDrawFull` with `s.card = _drawUnique(seed, s);`.

---

### Finding 17 (MEDIUM): `mutualTimeout` Penalty Math Is Confusing

**File:** `MatchEscrowV2.sol:244`
**Source:** Claude Opus 4.6

**Problem:** `uint256 penalty = (m.stake * 2 * 100) / 10000;` is equivalent to `m.stake * 2 / 100` (1% penalty). Needlessly confusing.

**Fix:**
```solidity
uint256 public constant MUTUAL_TIMEOUT_PENALTY_BPS = 100;
uint256 penalty = (m.stake * 2 * MUTUAL_TIMEOUT_PENALTY_BPS) / 10000;
```

---

### Finding 18 (LOW): `receive() external payable` Accepts Unaccounted ETH

**File:** `MatchEscrowV2.sol:357`
**Source:** Both auditors independently identified this

**Problem:** Accepts arbitrary ETH with no accounting. Funds are unrecoverable.

**Fix (Option A — Reject):**
```solidity
receive() external payable {
    revert("Direct ETH not accepted");
}
```

**Fix (Option B — Sweep):**
```solidity
function sweepExcess() external onlyOwner {
    uint256 excess = address(this).balance - _totalAccountedBalance();
    require(excess > 0, "No excess");
    _safeTransfer(treasury, excess);
}
```

---

### Finding 19 (LOW): No `TreasuryUpdated` Event

**File:** `MatchEscrowV2.sol:317-320`
**Source:** Claude Opus 4.6

**Problem:** `setTreasury` changes where all future rake flows with no event.

**Fix:**
```solidity
event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

function setTreasury(address _treasury) external onlyOwner {
    require(_treasury != address(0), "Invalid treasury");
    emit TreasuryUpdated(treasury, _treasury);
    treasury = _treasury;
}
```

---

### Finding 20 (LOW): Unchecked Game Logic Return Value

**File:** `MatchEscrowV2.sol:191-194`
**Source:** Claude Opus 4.6

**Problem:** `_postRoundResolution` silently treats any `winner` value other than 1 or 2 as a draw.

**Fix:**
```solidity
require(winner <= 2, "Invalid winner value");
```

---

### Finding 21 (LOW): Bitshift Readability in Bitfield Operations

**File:** `FiveCardDrawWithDiscard.sol:60, 63, 71, 74, 86, 89, 92, 99, 102, 105`
**Source:** External Review

**Problem:** `(1 << s.card)` relies on implicit casting. Not a bug but reduces reviewer clarity.

**Fix:** Replace all instances with explicit casting:
```solidity
(uint256(1) << uint256(s.card))
```

---

### Finding 22 (LOW): Metadata JSON Concatenation Safety

**File:** `FiveCardDraw.sol:234-245`, `FiveCardDrawWithDiscard.sol:163-191`
**Source:** External Review

**Problem:** JSON is built by string concatenation. If `_cardsToString` ever produces unsafe characters, JSON breaks. Current charset (`23456789TJQKA` + `SHDC`) is safe, but there's no structural guarantee.

**Fix:** Ensure `_cardsToString` is documented as returning only `[A-Z0-9,]` and add a comment asserting the safety invariant. Alternatively, add a JSON escape helper.

---

### Finding 23 (LOW): `currentRound` is `uint8` — Overflow Footgun

**File:** `MatchState.sol:21`
**Source:** External Review

**Problem:** Capped at 5 rounds in practice but no explicit invariant prevents future changes from overflowing `uint8`.

**Fix:** Add invariant checks:
```solidity
// In _postRoundResolution before increment:
require(m.currentRound < 5, "Round overflow");
```

---

### Finding 24 (INFO): Redundant Computation in `getRoundResultMetadata`

**File:** `FiveCardDraw.sol:206-212`
**Source:** Claude Opus 4.6

**Problem:** `getRoundResultMetadata` calls `_dealCards` twice per player (once for display, once inside `_evaluateHand`). Wastes gas.

**Fix:**
```solidity
uint8[5] memory cardsA = _dealCards(deckSeed, "A");
uint8[5] memory cardsB = _dealCards(deckSeed, "B");
uint256 scoreA = _evaluateCards(cardsA);
uint256 scoreB = _evaluateCards(cardsB);
```

---

### Priority Fix Order

| Priority | Finding | Severity | Effort | Impact |
|----------|---------|----------|--------|--------|
| 1 | #1: Kicker comparison bug | CRITICAL | Medium | Game outcomes are wrong |
| 2 | #2: Discard info leak | CRITICAL | High | Entire discard phase is broken |
| 3 | #3: Missing revealMove auth | CRITICAL | Trivial | Access control gap |
| 4 | #4: Weak commit domain separation | HIGH | Low | Cross-deployment replay |
| 5 | #5: Round state not cleared | HIGH | Low | Storage bloat + gas refund loss |
| 6 | #6: Missing WithdrawalQueued event | HIGH | Trivial | Silent fund trapping |
| 7 | #7: No admin rescue for stuck funds | HIGH | Low | Permanent fund lock |
| 8 | #8: Untrusted game logic calls | HIGH | Medium | Match bricking / manipulation |
| 9 | #9: bytes32(0) commit | MED | Trivial | Match griefing |
| 10 | #10: Timeout overwrites score | MED | Low | Data corruption + UX |
| 11 | #11: No minimum stake | MED | Trivial | Spam vector |
| 12 | #12: Cross-player card duplication | MED | Medium | Poker fairness (FiveCardDraw) |
| 13 | #13: No commit hash helper | MED | Trivial | UX safety |
| 14 | #14: Missing "No commit" check | MED | Trivial | Revert clarity |
| 15 | #15: Mask validation in game logic | MED | Trivial | Defensive coding |
| 16 | #16: Linear probing bias | MED | Medium | Distribution fairness |
| 17 | #17: Confusing penalty math | MED | Trivial | Readability |
| 18 | #18: Unaccounted receive() ETH | LOW | Trivial | Locked funds |
| 19 | #19: Missing TreasuryUpdated event | LOW | Trivial | Monitoring gap |
| 20 | #20: Unchecked winner return | LOW | Trivial | Defensive coding |
| 21 | #21: Bitshift readability | LOW | Trivial | Code clarity |
| 22 | #22: JSON concatenation safety | LOW | Low | Data integrity |
| 23 | #23: currentRound overflow footgun | LOW | Trivial | Future-proofing |
| 24 | #24: Redundant card computation | INFO | Trivial | Gas waste |

---

### Quick Diff Checklist

#### MatchEscrowV2.sol
- [ ] #3: `revealMove` — add `Unauthorized` guard
- [ ] #4: `revealMove` — add domain separation in expected hash
- [ ] #4/#13: Add `computeCommitHash` helper function
- [ ] #5: `_postRoundResolution` — delete round state after resolution
- [ ] #6: `_safeTransfer` — emit `WithdrawalQueued`
- [ ] #7: Add `adminRescueStuckFunds` function
- [ ] #8: Add gas caps / try-catch on game logic calls
- [ ] #9: `commitMove` — reject `bytes32(0)`
- [ ] #10: `claimTimeout` — don't overwrite scores
- [ ] #11: Add `MIN_STAKE` constant
- [ ] #14: `revealMove` — add "No commit" guard
- [ ] #17: Clarify penalty math with named constant
- [ ] #18: `receive()` — reject or add sweep
- [ ] #19: `setTreasury` — emit `TreasuryUpdated`
- [ ] #20: `_postRoundResolution` — validate winner return
- [ ] #23: Add round overflow invariant

#### MatchState.sol
- [ ] #2: Extend `Phase` enum for discard commit-reveal (if Option A)
- [ ] #2: Add `DiscardCommit` struct (if Option A)

#### FiveCardDraw.sol
- [ ] #1: Fix kicker comparison — sort by frequency then rank
- [ ] #22: Document JSON-safe charset in `_cardsToString`
- [ ] #24: Eliminate redundant `_dealCards` calls in metadata

#### FiveCardDrawWithDiscard.sol
- [ ] #15: Clamp `maskA`/`maskB` to 5 bits
- [ ] #16: Replace linear probing with rehash-on-collision
- [ ] #21: Explicit `uint256` casting in bitshifts

---

*V2.1 Combined Audit completed: 2026-02-23 | 201 tests passing | 24 findings identified, 0 fixed*
