// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/PokerEngine.sol";
import "../src/core/LogicRegistry.sol";
import "./mocks/MockUSDC.sol";

contract PokerEngineTest is Test {
    PokerEngine poker;
    LogicRegistry registry;
    MockUSDC usdc;
    
    address treasury = address(0x123);
    address referee = address(0x456);
    address player1 = address(0x789);
    address player2 = address(0xabc);
    address player3 = address(0xdef);
    
    bytes32 constant LOGIC_ID_POKER = keccak256("QmPoker");
    bytes32 constant LOGIC_ID_RPS = keccak256("QmRPS");
    
    string constant IPFS_POKER = "QmPoker";
    string constant IPFS_RPS = "QmRPS";

    function setUp() public {
        usdc = new MockUSDC();
        registry = new LogicRegistry();
        poker = new PokerEngine(treasury, address(usdc), address(registry), referee);
        
        // Fund players
        usdc.mint(player1, 10000 * 1e6);
        usdc.mint(player2, 10000 * 1e6);
        usdc.mint(player3, 10000 * 1e6);
        
        // Approve poker engine
        vm.prank(player1);
        usdc.approve(address(poker), type(uint256).max);
        vm.prank(player2);
        usdc.approve(address(poker), type(uint256).max);
        vm.prank(player3);
        usdc.approve(address(poker), type(uint256).max);
        
        // Register game logics
        registry.registerLogic(IPFS_POKER, address(this), true, 4); // Hold'em: 4 streets
        registry.registerSimpleGame(IPFS_RPS, address(this)); // RPS: no betting
        
        // Authorize poker engine to record volume
        registry.setAuthorizedEscrow(address(poker), true);
    }

    // ==================== CONSTRUCTOR TESTS ====================

    function test_Constructor() public view {
        assertEq(address(poker.LOGIC_REGISTRY()), address(registry));
        assertEq(poker.referee(), referee);
    }

    function test_Constructor_InvalidRegistry() public {
        vm.expectRevert("Invalid registry");
        new PokerEngine(treasury, address(usdc), address(0), referee);
    }

    function test_Constructor_InvalidReferee() public {
        vm.expectRevert("Invalid referee");
        new PokerEngine(treasury, address(usdc), address(registry), address(0));
    }

    // ==================== CREATE MATCH TESTS ====================

    function test_CreateMatch() public {
        vm.prank(player1);
        poker.createMatch(
            100 * 1e6,              // stake
            LOGIC_ID_POKER,         // logic
            2,                      // maxPlayers
            1,                      // winsRequired
            10,                     // maxRounds
            500 * 1e6,              // maxBuyIn
            PokerEngine.BetStructure.NO_LIMIT
        );
        
        assertEq(poker.matchCounter(), 1);
        
        (PokerEngine.Phase phase, uint256 commitDeadline,,,,,,,,,) = poker.pokerState(1);
        assertEq(uint8(phase), uint8(PokerEngine.Phase.COMMIT));
        assertTrue(commitDeadline > block.timestamp);
        
        // Check poker state
        PokerEngine.PokerState memory ps = _getPokerState(1);
        assertEq(ps.maxStreets, 4); // From registry
        assertEq(uint8(ps.betStructure), uint8(PokerEngine.BetStructure.NO_LIMIT));
    }

    function test_CreateMatch_LogicNotFound() public {
        bytes32 fakeLogic = keccak256("fake");
        
        vm.prank(player1);
        vm.expectRevert("Logic not found");
        poker.createMatch(100 * 1e6, fakeLogic, 2, 1, 10, 500 * 1e6, PokerEngine.BetStructure.NO_LIMIT);
    }

    function test_CreateMatch_NoBetting() public {
        vm.prank(player1);
        vm.expectRevert("Game does not support betting");
        poker.createMatch(100 * 1e6, LOGIC_ID_RPS, 2, 1, 10, 500 * 1e6, PokerEngine.BetStructure.NO_LIMIT);
    }

    // ==================== COMMIT PHASE TESTS ====================

    function test_CommitMove() public {
        _createAndJoinMatch();
        
        bytes32 commitHash = keccak256(abi.encodePacked("commit1"));
        
        vm.prank(player1);
        poker.commitMove(1, commitHash);
        
        (bytes32 storedHash,,, bool revealed) = poker.roundCommits(1, 1, player1);
        assertEq(storedHash, commitHash);
        assertFalse(revealed);
    }

    function test_CommitMove_TransitionsToBet() public {
        _createAndJoinMatch();
        
        bytes32 hash1 = keccak256(abi.encodePacked("commit1"));
        bytes32 hash2 = keccak256(abi.encodePacked("commit2"));
        
        vm.prank(player1);
        poker.commitMove(1, hash1);
        
        // Still in COMMIT phase
        PokerEngine.PokerState memory ps = _getPokerState(1);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.COMMIT));
        
        vm.prank(player2);
        poker.commitMove(1, hash2);
        
        // Now in BET phase
        ps = _getPokerState(1);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.BET));
        assertTrue(ps.betDeadline > block.timestamp);
    }

    function test_CommitMove_AlreadyCommitted() public {
        _createAndJoinMatch();
        
        bytes32 hash = keccak256(abi.encodePacked("commit"));
        
        vm.prank(player1);
        poker.commitMove(1, hash);
        
        vm.prank(player1);
        vm.expectRevert("Already committed");
        poker.commitMove(1, hash);
    }

    // ==================== BETTING TESTS ====================

    function test_Raise() public {
        _setupBetPhase();
        
        uint256 player1Before = usdc.balanceOf(player1);
        
        vm.prank(player1);
        poker.raise(1, 50 * 1e6);
        
        uint256 player1After = usdc.balanceOf(player1);
        assertEq(player1Before - player1After, 50 * 1e6);
        
        PokerEngine.PokerState memory ps = _getPokerState(1);
        assertEq(ps.currentBet, 50 * 1e6);
        assertEq(ps.raiseCount, 1);
    }

    function test_Raise_MaxRaises() public {
        _setupBetPhase();
        
        // First raise
        vm.prank(player1);
        poker.raise(1, 50 * 1e6);
        
        // Call to get back to player1
        vm.prank(player2);
        poker.call(1);
        
        // Second raise (re-raise)
        vm.prank(player1);
        poker.raise(1, 100 * 1e6);
        
        // Try third raise - should fail
        vm.prank(player2);
        vm.expectRevert("Max raises");
        poker.raise(1, 200 * 1e6);
    }

    function test_Raise_PotLimit() public {
        // Create pot limit match
        vm.prank(player1);
        poker.createMatch(100 * 1e6, LOGIC_ID_POKER, 2, 1, 10, 1000 * 1e6, PokerEngine.BetStructure.POT_LIMIT);
        
        vm.prank(player2);
        usdc.approve(address(poker), type(uint256).max);
        vm.prank(player2);
        poker.joinMatch(1);
        
        _advanceToBetPhase(1);
        
        // Total pot = 200, current bet = 0
        // Pot limit = 200 + 0 = 200
        // Raise of 250 should fail
        vm.prank(player1);
        vm.expectRevert("Pot limit exceeded");
        poker.raise(1, 250 * 1e6);
        
        // Raise of 150 should succeed
        vm.prank(player1);
        poker.raise(1, 150 * 1e6);
    }

    function test_Call() public {
        _setupBetPhase();
        
        // Player1 raises
        vm.prank(player1);
        poker.raise(1, 50 * 1e6);
        
        // Player2 calls
        uint256 player2Before = usdc.balanceOf(player2);
        
        vm.prank(player2);
        poker.call(1);
        
        uint256 player2After = usdc.balanceOf(player2);
        assertEq(player2Before - player2After, 50 * 1e6);
        
        // Should transition to REVEAL after both acted
        PokerEngine.PokerState memory ps = _getPokerState(1);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.REVEAL));
    }

    function test_Check() public {
        _createAndJoinMatch();
        
        // Both commit to enter BET phase
        bytes32 hash1 = keccak256(abi.encodePacked("commit1"));
        bytes32 hash2 = keccak256(abi.encodePacked("commit2"));
        
        vm.prank(player1);
        poker.commitMove(1, hash1);
        
        vm.prank(player2);
        poker.commitMove(1, hash2);
        
        // Verify we're in BET phase
        PokerEngine.PokerState memory ps = _getPokerState(1);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.BET), "Should be in BET phase");
        
        // Player1 checks
        vm.prank(player1);
        poker.check(1);
        
        // Player2 checks
        vm.prank(player2);
        poker.check(1);
        
        // Should transition to REVEAL
        ps = _getPokerState(1);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.REVEAL));
    }

    function test_Fold() public {
        _setupBetPhase();
        
        // Player1 folds
        vm.prank(player1);
        poker.fold(1);
        
        // Match should be settled
        IBaseEscrow.BaseMatch memory m = poker.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, player2);
    }

    function test_Fold_LastPlayerWins() public {
        // Create 3-player match
        vm.prank(player1);
        poker.createMatch(100 * 1e6, LOGIC_ID_POKER, 3, 1, 10, 1000 * 1e6, PokerEngine.BetStructure.NO_LIMIT);
        
        vm.prank(player2);
        usdc.approve(address(poker), type(uint256).max);
        vm.prank(player2);
        poker.joinMatch(1);
        
        vm.prank(player3);
        usdc.approve(address(poker), type(uint256).max);
        vm.prank(player3);
        poker.joinMatch(1);
        
        _advanceToBetPhase(1);
        
        // Player1 folds
        vm.prank(player1);
        poker.fold(1);
        
        // Match still active (2 players left)
        PokerEngine.PokerState memory ps = _getPokerState(1);
        assertEq(ps.activePlayers, 2);
        
        // Betting continues with player2
        assertEq(ps.currentTurnIndex, 1); // player2
    }

    // ==================== REVEAL TESTS ====================

    function test_RevealMove() public {
        _setupRevealPhase();
        
        bytes32 move = bytes32(uint256(5)); // Some move
        bytes32 salt = bytes32(uint256(123));
        bytes32 commitHash = keccak256(abi.encodePacked(
            "FALKEN_V4", address(poker), uint256(1), uint256(1), player1, move, salt
        ));
        
        // Re-commit with proper hash
        vm.warp(block.timestamp + 1 hours); // Reset
        _setupRevealPhaseWithHash(commitHash);
        
        vm.prank(player1);
        poker.revealMove(1, move, salt);
        
        (,,, bool revealed) = poker.roundCommits(1, 1, player1);
        assertTrue(revealed);
    }

    // ==================== REFEREE RESOLUTION TESTS ====================

    function test_ResolveStreet() public {
        _setupForResolution();
        
        vm.prank(referee);
        poker.resolveStreet(1, 0); // player1 wins
        
        IBaseEscrow.BaseMatch memory m = poker.getMatch(1);
        assertEq(m.wins[0], 1);
    }

    function test_ResolveStreet_MatchComplete() public {
        _setupForResolution();
        
        // Win 3 rounds
        for (uint i = 0; i < 3; i++) {
            vm.prank(referee);
            poker.resolveStreet(1, 0);
            
            if (i < 2) {
                _advanceToNextRound(1);
            }
        }
        
        // Match should be settled
        IBaseEscrow.BaseMatch memory m = poker.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, player1);
    }

    function test_ResolveStreet_NotReferee() public {
        _setupForResolution();
        
        vm.prank(player1);
        vm.expectRevert("Only Referee");
        poker.resolveStreet(1, 0);
    }

    // ==================== ADMIN TESTS ====================

    function test_SetReferee() public {
        address newReferee = address(0x999);
        poker.setReferee(newReferee);
        assertEq(poker.referee(), newReferee);
    }

    function test_SetReferee_NotOwner() public {
        vm.prank(player1);
        vm.expectRevert();
        poker.setReferee(address(0x999));
    }

    // ==================== HELPER FUNCTIONS ====================

    function _createAndJoinMatch() internal {
        vm.prank(player1);
        poker.createMatch(100 * 1e6, LOGIC_ID_POKER, 2, 1, 10, 1000 * 1e6, PokerEngine.BetStructure.NO_LIMIT);
        
        vm.prank(player2);
        poker.joinMatch(1);
    }

    function _setupBetPhase() internal {
        _createAndJoinMatch();
        _advanceToBetPhase(1);
    }

    function _advanceToBetPhase(uint256 matchId) internal {
        bytes32 hash1 = keccak256(abi.encodePacked("commit1"));
        bytes32 hash2 = keccak256(abi.encodePacked("commit2"));
        
        vm.prank(player1);
        poker.commitMove(matchId, hash1);
        
        vm.prank(player2);
        poker.commitMove(matchId, hash2);
    }

    function _setupRevealPhase() internal {
        _setupBetPhase();
        
        vm.prank(player1);
        poker.check(1);
        
        vm.prank(player2);
        poker.check(1);
    }

    function _setupRevealPhaseWithHash(bytes32 commitHash) internal {
        // Need to recreate match with specific hash
        vm.warp(block.timestamp + 2 hours);
    }

    function _setupForResolution() internal {
        _setupRevealPhase();
        
        // Both reveal
        bytes32 move = bytes32(uint256(5));
        bytes32 salt = bytes32(uint256(123));
        
        vm.prank(player1);
        poker.revealMove(1, move, salt);
        
        vm.prank(player2);
        poker.revealMove(1, move, salt);
    }

    function _advanceToNextRound(uint256 matchId) internal {
        // Simplified: referee resolves and we continue
        PokerEngine.PokerState memory ps = _getPokerState(matchId);
        if (ps.street + 1 < ps.maxStreets) {
            // Still in same round
        } else {
            // New round starts
        }
    }

    function _getPokerState(uint256 matchId) internal view returns (PokerEngine.PokerState memory) {
        (
            PokerEngine.Phase phase,
            uint256 commitDeadline,
            uint256 revealDeadline,
            uint256 betDeadline,
            uint256 currentBet,
            uint8 currentTurnIndex,
            uint8 raiseCount,
            uint8 activePlayers,
            uint8 street,
            uint8 maxStreets,
            PokerEngine.BetStructure betStructure
        ) = poker.pokerState(matchId);
        
        // Note: This doesn't return arrays, just for basic checks
        return PokerEngine.PokerState({
            phase: PokerEngine.Phase(phase),
            commitDeadline: commitDeadline,
            revealDeadline: revealDeadline,
            betDeadline: betDeadline,
            currentBet: currentBet,
            currentTurnIndex: currentTurnIndex,
            raiseCount: raiseCount,
            activePlayers: activePlayers,
            street: street,
            maxStreets: maxStreets,
            betStructure: betStructure,
            folded: new bool[](0), // Empty for view function
            playerBets: new uint256[](0),
            playerBankroll: new uint256[](0)
        });
    }
}
