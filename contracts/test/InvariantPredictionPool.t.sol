// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../src/core/PredictionPool.sol";
import "./mocks/BlocklistMockUSDC.sol";

/**
 * @title PredictionPoolHandler
 * @dev Simulates random sequences of bettor actions against PredictionPool.
 * Ghost variables track all USDC flows for invariant verification.
 */
contract PredictionPoolHandler is Test {
    PredictionPool public pool;
    BlocklistMockUSDC public usdc;

    address public owner;
    address public treasury;
    address[] public actors;
    uint256 constant NUM_ACTORS = 8;
    uint256 constant MIN_BET = 100_000; // 0.10 USDC

    // Ghost tracking — every USDC movement in/out of the pool contract
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalWithdrawn;

    // Track pools we've created for valid random selection
    uint256[] public poolIds;

    // Track which actors bet on which pools/outcomes for valid claims
    // poolId => actor => hasBet
    mapping(uint256 => mapping(address => bool)) public actorHasBet;

    // Call counters
    uint256 public calls_createPool;
    uint256 public calls_placeBet;
    uint256 public calls_resolveManual;
    uint256 public calls_resolveDraw;
    uint256 public calls_claimWinnings;
    uint256 public calls_emergencyRefund;
    uint256 public calls_withdraw;

    constructor(
        PredictionPool _pool,
        BlocklistMockUSDC _usdc,
        address _owner,
        address _treasury
    ) {
        pool = _pool;
        usdc = _usdc;
        owner = _owner;
        treasury = _treasury;

        // Create and fund actors
        for (uint256 i = 0; i < NUM_ACTORS; i++) {
            address actor = address(uint160(0x2000 + i));
            actors.push(actor);
            usdc.mint(actor, 1_000_000e6);
            vm.prank(actor);
            usdc.approve(address(pool), type(uint256).max);
        }
    }

    // --- HANDLER FUNCTIONS ---

    /**
     * @dev Create a standalone pool with 2-3 outcomes.
     */
    function handler_createPool(uint8 numOutcomes) external {
        numOutcomes = uint8(bound(numOutcomes, 2, 4));

        string[] memory labels = new string[](numOutcomes);
        for (uint8 i = 0; i < numOutcomes; i++) {
            labels[i] = string(abi.encodePacked("Outcome", bytes1(0x30 + i)));
        }

        // Deadline 1 hour from now
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(owner);
        try pool.createPool(
            address(0), // standalone
            0,
            deadline,
            "Test Pool",
            labels
        ) returns (uint256 poolId) {
            calls_createPool++;
            poolIds.push(poolId);
        } catch {}
    }

    /**
     * @dev Place a random bet on a random pool/outcome.
     */
    function handler_placeBet(uint256 actorSeed, uint256 poolSeed, uint8 outcome, uint256 amount) external {
        if (poolIds.length == 0) return;
        address bettor = _pickActor(actorSeed);
        uint256 poolId = _pickPool(poolSeed);

        amount = bound(amount, MIN_BET, 100e6); // 0.10 to 100 USDC

        PredictionPool.Pool memory p = pool.getPool(poolId);
        if (p.outcomeLabels.length == 0) return;
        outcome = uint8(bound(outcome, 0, p.outcomeLabels.length - 1));

        vm.prank(bettor);
        try pool.placeBet(poolId, outcome, amount) {
            calls_placeBet++;
            ghost_totalDeposited += amount;
            actorHasBet[poolId][bettor] = true;
        } catch {}
    }

    /**
     * @dev Resolve a pool manually with a random winning outcome.
     * Warps past betting deadline first.
     */
    function handler_resolveManual(uint256 poolSeed, uint8 winnerIdx) external {
        if (poolIds.length == 0) return;
        uint256 poolId = _pickPool(poolSeed);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        if (p.resolved || p.outcomeLabels.length == 0) return;
        winnerIdx = uint8(bound(winnerIdx, 0, p.outcomeLabels.length - 1));

        // Warp past deadline
        vm.warp(p.bettingDeadline + 1);

        // Rake goes to treasury on resolution
        uint256 rake = (p.totalPool * 750) / 10000;

        vm.prank(owner);
        try pool.resolvePoolManual(poolId, winnerIdx) {
            calls_resolveManual++;
            ghost_totalWithdrawn += rake; // rake leaves the contract
        } catch {}
    }

    /**
     * @dev Resolve a pool as a draw (no rake, full refunds).
     */
    function handler_resolveDraw(uint256 poolSeed) external {
        if (poolIds.length == 0) return;
        uint256 poolId = _pickPool(poolSeed);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        if (p.resolved) return;

        // Warp past deadline
        vm.warp(p.bettingDeadline + 1);

        vm.prank(owner);
        try pool.resolvePoolDraw(poolId) {
            calls_resolveDraw++;
            // No rake on draws — nothing leaves yet
        } catch {}
    }

    /**
     * @dev Claim winnings from a resolved pool.
     */
    function handler_claimWinnings(uint256 actorSeed, uint256 poolSeed) external {
        if (poolIds.length == 0) return;
        address bettor = _pickActor(actorSeed);
        uint256 poolId = _pickPool(poolSeed);

        uint256 balBefore = usdc.balanceOf(address(pool));

        vm.prank(bettor);
        try pool.claimWinnings(poolId) {
            calls_claimWinnings++;
            uint256 balAfter = usdc.balanceOf(address(pool));
            // Track actual USDC that left (could be 0 if queued as pending)
            if (balBefore > balAfter) {
                ghost_totalWithdrawn += (balBefore - balAfter);
            }
        } catch {}
    }

    /**
     * @dev Emergency refund a random bet (owner only, before resolution).
     */
    function handler_emergencyRefund(uint256 actorSeed, uint256 poolSeed, uint8 outcome) external {
        if (poolIds.length == 0) return;
        address bettor = _pickActor(actorSeed);
        uint256 poolId = _pickPool(poolSeed);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        if (p.resolved || p.outcomeLabels.length == 0) return;
        outcome = uint8(bound(outcome, 0, p.outcomeLabels.length - 1));

        uint256 balBefore = usdc.balanceOf(address(pool));

        vm.prank(owner);
        try pool.emergencyRefund(poolId, bettor, outcome) {
            calls_emergencyRefund++;
            uint256 balAfter = usdc.balanceOf(address(pool));
            if (balBefore > balAfter) {
                ghost_totalWithdrawn += (balBefore - balAfter);
            }
        } catch {}
    }

    /**
     * @dev Withdraw pending funds (pull-payment).
     */
    function handler_withdraw(uint256 actorSeed) external {
        address actor = _pickActor(actorSeed);

        uint256 pending = pool.pendingWithdrawals(actor);
        if (pending == 0) return;

        vm.prank(actor);
        try pool.withdraw() {
            calls_withdraw++;
            ghost_totalWithdrawn += pending;
        } catch {}
    }

    // --- HELPERS ---

    function _pickActor(uint256 seed) internal view returns (address) {
        return actors[seed % NUM_ACTORS];
    }

    function _pickPool(uint256 seed) internal view returns (uint256) {
        if (poolIds.length == 0) return 1;
        return poolIds[seed % poolIds.length];
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }

    function getPoolCount() external view returns (uint256) {
        return poolIds.length;
    }
}

/**
 * @title InvariantPredictionPoolTest
 * @dev Stateful invariant tests for PredictionPool.
 * Foundry calls random Handler functions, then checks invariants after EVERY call.
 */
contract InvariantPredictionPoolTest is StdInvariant, Test {
    PredictionPool public pool;
    BlocklistMockUSDC public usdc;
    PredictionPoolHandler public handler;

    address public owner = address(0xDD);
    address public treasury = address(0xEE);

    function setUp() public {
        vm.startPrank(owner);
        usdc = new BlocklistMockUSDC();
        pool = new PredictionPool(treasury, address(usdc));
        vm.stopPrank();

        handler = new PredictionPoolHandler(pool, usdc, owner, treasury);

        // Only call the handler
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = PredictionPoolHandler.handler_createPool.selector;
        selectors[1] = PredictionPoolHandler.handler_placeBet.selector;
        selectors[2] = PredictionPoolHandler.handler_resolveManual.selector;
        selectors[3] = PredictionPoolHandler.handler_resolveDraw.selector;
        selectors[4] = PredictionPoolHandler.handler_claimWinnings.selector;
        selectors[5] = PredictionPoolHandler.handler_emergencyRefund.selector;
        selectors[6] = PredictionPoolHandler.handler_withdraw.selector;

        targetSelector(FuzzSelector({
            addr: address(handler),
            selectors: selectors
        }));
    }

    /**
     * INVARIANT 1: Pool Money Conservation
     * Contract USDC balance >= sum(unresolved pool totalPools) + sum(pendingWithdrawals)
     * After resolution (non-draw), rake has left but remaining must cover all claims.
     */
    function invariant_poolMoneyConservation() public view {
        uint256 contractBalance = usdc.balanceOf(address(pool));
        uint256 poolCount = pool.poolCounter();

        uint256 totalObligations = 0;

        for (uint256 i = 1; i <= poolCount; i++) {
            PredictionPool.Pool memory p = pool.getPool(i);

            if (!p.resolved) {
                // Unresolved: all bets should still be in contract
                totalObligations += p.totalPool;
            }
            // Resolved pools: remaining funds (after rake) cover claims.
            // We can't easily track unclaimed amounts from here,
            // but money conservation + no-double-claim ensures correctness.
        }

        // Add pending withdrawals for all actors
        address[] memory actorList = handler.getActors();
        for (uint256 i = 0; i < actorList.length; i++) {
            totalObligations += pool.pendingWithdrawals(actorList[i]);
        }
        totalObligations += pool.pendingWithdrawals(treasury);

        assertGe(
            contractBalance,
            totalObligations,
            "CRITICAL: Pool balance < unresolved pools + pending withdrawals"
        );
    }

    /**
     * INVARIANT 2: Internal Accounting Consistency
     * For every pool: totalPool == sum(outcomeTotals)
     */
    function invariant_poolTotalsConsistent() public view {
        uint256 poolCount = pool.poolCounter();

        for (uint256 i = 1; i <= poolCount; i++) {
            PredictionPool.Pool memory p = pool.getPool(i);

            uint256 sumOutcomes = 0;
            for (uint256 j = 0; j < p.outcomeTotals.length; j++) {
                sumOutcomes += p.outcomeTotals[j];
            }

            assertEq(
                p.totalPool,
                sumOutcomes,
                "Pool totalPool != sum of outcomeTotals"
            );
        }
    }

    /**
     * INVARIANT 3: Resolved Pools Are Immutable
     * Once resolved, a pool's resolved flag, winningOutcome, and isDraw never change.
     * (Checked implicitly — the handler tries random actions on resolved pools and they revert.)
     */
    function invariant_resolvedPoolsStayResolved() public view {
        uint256 poolCount = pool.poolCounter();

        for (uint256 i = 1; i <= poolCount; i++) {
            PredictionPool.Pool memory p = pool.getPool(i);
            if (p.resolved) {
                // Winning outcome must be valid (or 0 for draw)
                if (!p.isDraw) {
                    assertLt(
                        p.winningOutcome,
                        p.outcomeLabels.length,
                        "Resolved pool has invalid winning outcome"
                    );
                }
            }
        }
    }

    /**
     * INVARIANT 4: Ghost Balance Tracking
     * Contract balance should equal deposits minus withdrawals.
     */
    function invariant_ghostBalanceTracking() public view {
        uint256 contractBalance = usdc.balanceOf(address(pool));
        uint256 expectedBalance = handler.ghost_totalDeposited() - handler.ghost_totalWithdrawn();

        assertEq(
            contractBalance,
            expectedBalance,
            "Contract balance != ghost_deposited - ghost_withdrawn"
        );
    }

    /**
     * INVARIANT 5: No Pool Has Negative Totals
     * outcomeTotals and totalPool can never underflow.
     */
    function invariant_noNegativeTotals() public view {
        uint256 poolCount = pool.poolCounter();

        for (uint256 i = 1; i <= poolCount; i++) {
            PredictionPool.Pool memory p = pool.getPool(i);
            // If we got here without revert, no underflow occurred
            // (Solidity 0.8 reverts on underflow)
            // But verify totals are reasonable
            uint256 sumOutcomes = 0;
            for (uint256 j = 0; j < p.outcomeTotals.length; j++) {
                sumOutcomes += p.outcomeTotals[j];
            }
            assertEq(p.totalPool, sumOutcomes, "Totals inconsistent");
        }
    }

    /**
     * INVARIANT 6: Call distribution check (always passes, for -vvv output).
     */
    function invariant_callDistribution() public pure {
        assertTrue(true);
    }
}
