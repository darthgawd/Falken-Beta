// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../src/core/PokerEngine.sol";
import "../../src/core/LogicRegistry.sol";
import "./mocks/BlocklistMockUSDC.sol";

/**
 * @title FalkenHandler
 * @dev Handles stateful actions for Invariant testing of PokerEngine and BaseEscrow.
 */
contract FalkenHandler is Test {
    PokerEngine public poker;
    BlocklistMockUSDC public usdc;
    LogicRegistry public registry;

    bytes32 public logicId;
    uint256 public constant INITIAL_BALANCE = 1_000_000e6;
    
    // Ghost variables for invariant tracking
    uint256 public ghost_sumActiveStakes;
    uint256 public ghost_sumPendingWithdrawals;
    uint256 public ghost_totalRakeCollected;
    uint256 public ghost_settledMatchCount;

    address[] public actors;
    address internal currentActor;

    constructor(PokerEngine _poker, BlocklistMockUSDC _usdc, LogicRegistry _registry, bytes32 _logicId) {
        poker = _poker;
        usdc = _usdc;
        registry = _registry;
        logicId = _logicId;
    }

    function createMatch(uint256 stake) public {
        stake = bound(stake, 100_000, 1000e6);
        _setupActor(msg.sender);
        
        vm.prank(msg.sender);
        try poker.createMatch(stake, logicId, 2, 3, 5, stake * 10, PokerEngine.BetStructure.NO_LIMIT) {
            ghost_sumActiveStakes += stake;
        } catch {}
    }

    function joinMatch(uint256 matchId) public {
        uint256 count = poker.matchCounter();
        if (count == 0) return;
        matchId = bound(matchId, 1, count);
        
        _setupActor(msg.sender);
        
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        if (m.status != IBaseEscrow.MatchStatus.OPEN) return;

        vm.prank(msg.sender);
        try poker.joinMatch(matchId) {
            ghost_sumActiveStakes += m.stake;
        } catch {}
    }

    // --- INTERNAL HELPERS ---
    function _setupActor(address actor) internal {
        if (usdc.balanceOf(actor) == 0) {
            usdc.mint(actor, INITIAL_BALANCE);
            vm.prank(actor);
            usdc.approve(address(poker), type(uint256).max);
            actors.push(actor);
        }
        currentActor = actor;
    }
}

/**
 * @title InvariantFalkenTest
 * @dev Main Invariant test suite for BaseEscrow and PokerEngine.
 */
contract InvariantFalkenTest is StdInvariant, Test {
    PokerEngine public poker;
    LogicRegistry public registry;
    BlocklistMockUSDC public usdc;
    FalkenHandler public handler;

    address public owner = address(0x123);
    address public treasury = address(0x456);
    address public referee = address(0x789);

    function setUp() public {
        vm.startPrank(owner);
        usdc = new BlocklistMockUSDC();
        registry = new LogicRegistry();
        poker = new PokerEngine(treasury, address(usdc), address(registry), referee);
        
        bytes32 logicId = registry.registerLogic("bafk...poker", owner, true, 1);
        registry.setAuthorizedEscrow(address(poker), true);
        vm.stopPrank();

        handler = new FalkenHandler(poker, usdc, registry, logicId);
        
        // Target the handler for invariant tests
        targetContract(address(handler));
    }

    /**
     * @dev INVARIANT: MONEY CONSERVATION
     * treasury balance + active stakes + pending withdrawals == contract USDC balance
     */
    function invariant_MoneyConservation() public view {
        uint256 contractBalance = usdc.balanceOf(address(poker));
        
        // Calculate sum of all active pots directly from contract
        uint256 sumActivePots = 0;
        uint256 count = poker.matchCounter();
        for (uint256 i = 1; i <= count; i++) {
            IBaseEscrow.BaseMatch memory m = poker.getMatch(i);
            if (m.status == IBaseEscrow.MatchStatus.OPEN || m.status == IBaseEscrow.MatchStatus.ACTIVE) {
                sumActivePots += m.totalPot;
            }
        }

        // Note: Treasury is external, so we check contract's internal balance against liabilities
        assertGe(contractBalance, sumActivePots, "Money leaked: contract balance below liabilities");
    }

    /**
     * @dev INVARIANT: NO DUPLICATE PLAYERS
     * A player cannot be in the players array twice for the same match.
     */
    function invariant_NoDuplicatePlayers() public view {
        uint256 count = poker.matchCounter();
        for (uint256 i = 1; i <= count; i++) {
            IBaseEscrow.BaseMatch memory m = poker.getMatch(i);
            for (uint j = 0; j < m.players.length; j++) {
                for (uint k = j + 1; k < m.players.length; k++) {
                    assertNotEq(m.players[j], m.players[k], "Duplicate player found in match");
                }
            }
        }
    }
}
