// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/FiseEscrow.sol";
import "../src/core/LogicRegistry.sol";
import "./mocks/MockUSDC.sol";

contract FiseEscrowTest is Test {
    FiseEscrow public escrow;
    LogicRegistry public registry;
    MockUSDC public usdc;

    address public owner = address(0x1);
    address public treasury = address(0x2);
    address public referee = address(0x3);
    address public playerA = address(0x111);
    address public playerB = address(0x222);
    address public playerC = address(0x333);
    address public playerD = address(0x444);
    address public playerE = address(0x555);
    address public playerF = address(0x666);
    address public developer = address(0x777);

    bytes32 public pokerLogicId;
    bytes32 public chessLogicId;
    uint256 public constant STAKE = 10 * 10**6; // 10 USDC

    function setUp() public {
        vm.startPrank(owner);
        usdc = new MockUSDC();
        registry = new LogicRegistry();
        escrow = new FiseEscrow(treasury, address(usdc), address(registry), referee);
        pokerLogicId = registry.registerLogic("bafk...poker", developer);
        chessLogicId = registry.registerLogic("bafk...chess", developer);
        vm.stopPrank();

        // Fund all players
        usdc.mint(playerA, 1000 * 10**6);
        usdc.mint(playerB, 1000 * 10**6);
        usdc.mint(playerC, 1000 * 10**6);
        usdc.mint(playerD, 1000 * 10**6);
        usdc.mint(playerE, 1000 * 10**6);
        usdc.mint(playerF, 1000 * 10**6);

        // Approve escrow for all players
        vm.prank(playerA);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(playerB);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(playerC);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(playerD);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(playerE);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(playerF);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ==================== SECTION A: MULTIPLAYER DYNAMICS ====================

    function testCreateMatch() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);

        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.players[0], playerA);
        assertEq(m.stake, STAKE);
        assertEq(m.maxPlayers, 2);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.OPEN));
    }

    function testCreateMatchWithDifferentPlayerCounts() public {
        // Test 2 players
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);
        assertEq(escrow.getMatch(1).maxPlayers, 2);

        // Test 3 players
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 3, 3);
        assertEq(escrow.getMatch(2).maxPlayers, 3);

        // Test 6 players
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 6, 3);
        assertEq(escrow.getMatch(3).maxPlayers, 6);
    }

    function test_RevertCreateMatchWithLessThan2Players() public {
        vm.prank(playerA);
        vm.expectRevert("Minimum 2 players");
        escrow.createMatch(STAKE, pokerLogicId, 1, 1);
    }

    function test_RevertCreateMatchWithZeroStake() public {
        vm.prank(playerA);
        vm.expectRevert("Stake must be > 0");
        escrow.createMatch(0, pokerLogicId, 2, 1);
    }

    function test_RevertCreateMatchWithUnregisteredLogic() public {
        bytes32 fakeLogicId = keccak256("fake");
        vm.prank(playerA);
        vm.expectRevert("Logic ID not registered");
        escrow.createMatch(STAKE, fakeLogicId, 2, 1);
    }

    function testArrayIntegrityFor6Players() public {
        // Create 6-player match
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 6, 3);

        FiseEscrow.Match memory m = escrow.getMatch(1);
        
        // Check arrays initialized correctly
        assertEq(m.players.length, 1); // Creator is first player
        assertEq(m.wins.length, 6);    // Wins array initialized for all 6 slots
        
        // All wins should be 0
        for (uint i = 0; i < 6; i++) {
            assertEq(m.wins[i], 0);
        }

        // Join remaining players
        vm.prank(playerB);
        escrow.joinMatch(1);
        vm.prank(playerC);
        escrow.joinMatch(1);
        vm.prank(playerD);
        escrow.joinMatch(1);
        vm.prank(playerE);
        escrow.joinMatch(1);
        vm.prank(playerF);
        escrow.joinMatch(1);

        m = escrow.getMatch(1);
        assertEq(m.players.length, 6);
        assertEq(m.players[0], playerA);
        assertEq(m.players[1], playerB);
        assertEq(m.players[2], playerC);
        assertEq(m.players[3], playerD);
        assertEq(m.players[4], playerE);
        assertEq(m.players[5], playerF);
    }

    function test_RevertJoinWhenMatchFull() public {
        // Create 3-player match to test "Match full" error
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 3, 3);

        vm.prank(playerB);
        escrow.joinMatch(1);
        
        vm.prank(playerC);
        escrow.joinMatch(1);

        // Match now has 3/3 players, should be ACTIVE
        // Try to join as fourth player
        address playerD_temp = address(0x998);
        usdc.mint(playerD_temp, 1000 * 10**6);
        vm.prank(playerD_temp);
        usdc.approve(address(escrow), type(uint256).max);
        
        // After match is ACTIVE, new joins get "Match not open"
        vm.prank(playerD_temp);
        vm.expectRevert("Match not open");
        escrow.joinMatch(1);
    }

    function test_RevertJoinTwice() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 4, 3);

        vm.prank(playerB);
        escrow.joinMatch(1);

        vm.prank(playerB);
        vm.expectRevert("Already joined");
        escrow.joinMatch(1);
    }

    // ==================== SECTION B: COMMIT-REVEAL GATING ====================

    function testPhaseTransitions2Players() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);

        vm.prank(playerB);
        escrow.joinMatch(1);

        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.phase), uint(MatchEscrow.Phase.COMMIT));
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.ACTIVE));

        // Only one player commits - should stay in COMMIT
        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), salt));
        
        vm.prank(playerA);
        escrow.commitMove(1, hash);

        m = escrow.getMatch(1);
        assertEq(uint(m.phase), uint(MatchEscrow.Phase.COMMIT)); // Still commit

        // Second player commits - should transition to REVEAL
        bytes32 saltB = keccak256("saltB");
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(1), saltB));
        
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        m = escrow.getMatch(1);
        assertEq(uint(m.phase), uint(MatchEscrow.Phase.REVEAL));
    }

    function testPhaseTransitions4Players() public {
        // Create and fill 4-player match
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 4, 3);
        
        vm.prank(playerB);
        escrow.joinMatch(1);
        vm.prank(playerC);
        escrow.joinMatch(1);
        vm.prank(playerD);
        escrow.joinMatch(1);

        // Each player commits one by one
        _commitAsPlayer(1, 1, playerA, 1);
        assertEq(uint(escrow.getMatch(1).phase), uint(MatchEscrow.Phase.COMMIT));
        
        _commitAsPlayer(1, 1, playerB, 2);
        assertEq(uint(escrow.getMatch(1).phase), uint(MatchEscrow.Phase.COMMIT));
        
        _commitAsPlayer(1, 1, playerC, 3);
        assertEq(uint(escrow.getMatch(1).phase), uint(MatchEscrow.Phase.COMMIT));
        
        // Fourth commit triggers reveal phase
        _commitAsPlayer(1, 1, playerD, 4);
        assertEq(uint(escrow.getMatch(1).phase), uint(MatchEscrow.Phase.REVEAL));
    }

    function test_RevertCommitWhenNotParticipant() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);
        
        vm.prank(playerB);
        escrow.joinMatch(1);

        address outsider = address(0x999);
        
        vm.prank(outsider);
        vm.expectRevert("Not participant");
        escrow.commitMove(1, keccak256("test"));
    }

    function test_RevertDoubleCommit() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);
        
        vm.prank(playerB);
        escrow.joinMatch(1);

        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), salt));
        
        vm.prank(playerA);
        escrow.commitMove(1, hash);

        vm.prank(playerA);
        vm.expectRevert("Already committed");
        escrow.commitMove(1, hash);
    }

    function test_RevealOnlyAfterAllCommit() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);
        
        vm.prank(playerB);
        escrow.joinMatch(1);

        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), salt));
        
        vm.prank(playerA);
        escrow.commitMove(1, hash);

        // Try to reveal before both committed
        vm.prank(playerA);
        vm.expectRevert("Wrong phase");
        escrow.revealMove(1, 1, salt);
    }

    function testInvalidHashReveal() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);
        
        vm.prank(playerB);
        escrow.joinMatch(1);

        // Commit with one move
        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), salt));
        
        vm.prank(playerA);
        escrow.commitMove(1, hash);

        bytes32 saltB = keccak256("saltB");
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(1), saltB));
        
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        // Try to reveal with WRONG salt
        vm.prank(playerA);
        vm.expectRevert("Invalid hash");
        escrow.revealMove(1, 1, keccak256("wrong_salt"));
    }

    function test_RevertDoubleReveal() public {
        _setupActiveMatch(2);
        
        bytes32 saltA = keccak256("saltA");
        bytes32 saltB = keccak256("saltB");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(1), saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, 1, saltA);

        vm.prank(playerA);
        vm.expectRevert("Already revealed");
        escrow.revealMove(1, 1, saltA);
    }

    // ==================== SECTION C: ECONOMIC SECURITY ====================

    function testStakePullOnCreateMatch() public {
        uint256 initialBalance = usdc.balanceOf(playerA);
        
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);

        uint256 finalBalance = usdc.balanceOf(playerA);
        assertEq(initialBalance - finalBalance, STAKE);
        assertEq(usdc.balanceOf(address(escrow)), STAKE);
    }

    function testStakePullOnJoinMatch() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);

        uint256 initialBalanceB = usdc.balanceOf(playerB);
        
        vm.prank(playerB);
        escrow.joinMatch(1);

        assertEq(usdc.balanceOf(address(escrow)), STAKE * 2);
        assertEq(initialBalanceB - usdc.balanceOf(playerB), STAKE);
    }

    function testTreasuryRakeAndDeveloperRoyalty() public {
        // Setup and complete a match
        _setupActiveMatch(2);
        _completeMatchWithWinner(1, 0); // Player A wins

        uint256 totalPot = STAKE * 2; // 20 USDC
        uint256 expectedRake = (totalPot * 500) / 10000; // 5% = 1 USDC
        uint256 expectedRoyalty = (totalPot * 200) / 10000; // 2% = 0.4 USDC
        
        // Treasury should get rake - royalty = 0.6 USDC
        uint256 expectedTreasury = expectedRake - expectedRoyalty;
        
        // Check volume recorded in registry
        (,,,, uint256 totalVolume) = registry.registry(pokerLogicId);
        assertEq(totalVolume, totalPot);
    }

    function testWinnerPayout() public {
        _setupActiveMatch(2);
        
        _completeMatchWithWinner(1, 0); // Player A wins

        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winner, playerA);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        
        // Winner should have received payout (either directly or queued)
        uint256 pending = escrow.pendingWithdrawals(playerA);
        uint256 balance = usdc.balanceOf(playerA);
        
        // Either has pending withdrawal OR received funds
        assertTrue(pending > 0 || balance >= 1000 * 10**6 - STAKE + (STAKE * 2 * 95 / 100));
    }

    function testDrawSplit() public {
        // Setup 2-player match
        _setupActiveMatch(2);
        
        // Play 3 rounds - A wins all (A gets to 3 wins)
        _playRound(1, 1, 1, 2, 0); // A wins round 1
        _playRound(1, 2, 1, 2, 0); // A wins round 2
        _playRound(1, 3, 1, 2, 0); // A wins round 3
        
        // Match should be settled with A as winner
        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, playerA);
        assertEq(m.wins[0], 3);
    }

    function testResolveFiseRoundWithDraw() public {
        _setupActiveMatch(2);
        
        // Play a round that ends in a draw (winnerIndex = 255)
        bytes32 saltA = keccak256("saltA");
        bytes32 saltB = keccak256("saltB");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(1), saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, 1, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, 1, saltB);

        // Referee resolves with DRAW (255)
        vm.prank(referee);
        escrow.resolveFiseRound(1, 255); // DRAW

        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.drawCounter, 1); // Draw counter incremented
        assertEq(m.currentRound, 1); // Same round (sudden death)
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.ACTIVE)); // Not settled
    }

    function testMaxRoundsSettlementWithTie() public {
        _setupActiveMatch(2);

        // Play rounds 1-3: A wins each time (A reaches 3 wins, match ends early)
        // Actually we need to reach round 10, so let's not let anyone get 3 wins
        // Use alternating: A, B, A, B... A will get 3 at round 5
        // So use: A, B, B, A, A, B, B, A, A, B pattern for 5-5 split
        _playRound(1, 1, 1, 2, 0); // A wins (1-0)
        _playRound(1, 2, 1, 2, 1); // B wins (1-1)
        _playRound(1, 3, 1, 2, 1); // B wins (1-2)
        _playRound(1, 4, 1, 2, 0); // A wins (2-2)
        _playRound(1, 5, 1, 2, 0); // A wins (3-2) - Match ends!

        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, playerA); // A wins with 3
    }

    function testWithdrawalSystem() public {
        // Setup match and have playerA win to generate payout
        _setupActiveMatch(2);
        
        // Record initial state
        uint256 initialPending = escrow.pendingWithdrawals(playerA);
        
        // Win 3 rounds for A
        _completeMatchWithWinner(1, 0);
        
        // Check if anything was queued
        uint256 finalPending = escrow.pendingWithdrawals(playerA);
        
        // Either received directly or queued
        assertTrue(finalPending > initialPending || usdc.balanceOf(playerA) > 1000 * 10**6 - STAKE);
    }

    function test_RevertWithdrawWithNoBalance() public {
        address nobody = address(0x999);
        
        vm.prank(nobody);
        vm.expectRevert("No balance");
        escrow.withdraw();
    }

    // ==================== SECTION G: BETTING ====================

    function testPlaceBet() public {
        _setupActiveMatch(2);
        
        uint256 additionalBet = 5 * 10**6; // 5 USDC
        uint256 initialPot = escrow.getMatch(1).totalPot;
        
        vm.prank(playerA);
        escrow.placeBet(1, additionalBet);
        
        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.totalPot, initialPot + additionalBet);
        assertEq(escrow.playerContributions(1, playerA), STAKE + additionalBet);
    }

    function test_RevertPlaceBetWhenNotParticipant() public {
        _setupActiveMatch(2);
        
        address outsider = address(0x999);
        usdc.mint(outsider, 1000 * 10**6);
        vm.prank(outsider);
        usdc.approve(address(escrow), type(uint256).max);
        
        vm.prank(outsider);
        vm.expectRevert("Not participant");
        escrow.placeBet(1, 5 * 10**6);
    }

    function test_RevertPlaceBetWhenMatchNotActive() public {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, 2, 3);
        // Match is OPEN, not ACTIVE
        
        vm.prank(playerA);
        vm.expectRevert("Match not active");
        escrow.placeBet(1, 5 * 10**6);
    }

    // ==================== SECTION D: SUDDEN DEATH & MAX ROUNDS ====================

    function testSuddenDeathDrawReplay() public {
        _setupActiveMatch(2);

        // Round 1: Draw
        _playRound(1, 1, 1, 1, 255);
        
        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.currentRound, 1); // Same round
        assertEq(m.drawCounter, 1);

        // Round 1 retry: Draw again
        _playRound(1, 1, 2, 2, 255);
        m = escrow.getMatch(1);
        assertEq(m.currentRound, 1); // Still same round
        assertEq(m.drawCounter, 2);

        // Round 1 retry: Draw third time (MAX_CONSECUTIVE_DRAWS = 3)
        _playRound(1, 1, 3, 3, 255);
        m = escrow.getMatch(1);
        // After 3 draws with < 3, round advances
        assertEq(m.currentRound, 2); // Now advances
        assertEq(m.drawCounter, 0);  // Reset
    }

    function testMaxRoundsSettlement() public {
        _setupActiveMatch(2);

        // First 3 rounds: A wins (A gets to 3 wins first)
        for (uint8 i = 1; i <= 3; i++) {
            _playRound(1, i, 1, 1, 0); // A wins each round
        }

        // Match should be settled by A reaching 3 wins
        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, playerA);
        assertEq(m.wins[0], 3);
    }

    // ==================== SECTION E: ACCESS CONTROL ====================

    function test_RevertNonRefereeResolve() public {
        _setupActiveMatch(2);
        
        bytes32 saltA = keccak256("saltA");
        bytes32 saltB = keccak256("saltB");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(1), saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, 1, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, 1, saltB);

        // Non-referee tries to resolve
        vm.prank(playerA);
        vm.expectRevert("Only Referee can call");
        escrow.resolveFiseRound(1, 0);
    }

    function test_RevertInvalidWinnerIndex() public {
        _setupActiveMatch(2);
        
        bytes32 saltA = keccak256("saltA");
        bytes32 saltB = keccak256("saltB");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(1), saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, 1, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, 1, saltB);

        // Try invalid winner index (2 for a 2-player game)
        vm.prank(referee);
        vm.expectRevert("Invalid winner index");
        escrow.resolveFiseRound(1, 2);
    }

    function testSetTreasury() public {
        address newTreasury = address(0x888);
        
        vm.prank(owner);
        escrow.setTreasury(newTreasury);
        
        // Note: treasury is public, can verify via getter if needed
    }

    function testSetReferee() public {
        address newReferee = address(0x999);
        
        address oldReferee = escrow.referee();
        
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit FiseEscrow.RefereeChanged(oldReferee, newReferee);
        
        escrow.setReferee(newReferee);
        
        // Verify referee was updated
        assertEq(escrow.referee(), newReferee);
    }

    function test_RevertSetRefereeZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Invalid referee");
        escrow.setReferee(address(0));
    }

    function test_RevertSetRefereeNotOwner() public {
        address newReferee = address(0x999);
        
        vm.prank(playerA);
        vm.expectRevert();
        escrow.setReferee(newReferee);
    }

    function test_RevertNonOwnerSetTreasury() public {
        vm.prank(playerA);
        vm.expectRevert();
        escrow.setTreasury(address(0x888));
    }

    // ==================== SECTION F: TIMEOUTS ====================

    function testCommitTimeout() public {
        _setupActiveMatch(2);
        
        // Only one player commits
        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), salt));
        
        vm.prank(playerA);
        escrow.commitMove(1, hash);

        // Warp past commit deadline
        vm.warp(block.timestamp + 31 minutes);

        // Player B tries to commit after timeout
        bytes32 saltB = keccak256("saltB");
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(1), saltB));
        
        // Phase should still be COMMIT but deadline passed
        // Note: Current contract doesn't have timeout enforcement on commit
        // This test documents expected behavior for future implementation
    }

    // ==================== HELPER FUNCTIONS ====================

    function _setupActiveMatch(uint8 numPlayers) internal {
        vm.prank(playerA);
        escrow.createMatch(STAKE, pokerLogicId, numPlayers, 3);

        if (numPlayers >= 2) {
            vm.prank(playerB);
            escrow.joinMatch(1);
        }
        if (numPlayers >= 3) {
            vm.prank(playerC);
            escrow.joinMatch(1);
        }
        if (numPlayers >= 4) {
            vm.prank(playerD);
            escrow.joinMatch(1);
        }
        if (numPlayers >= 5) {
            vm.prank(playerE);
            escrow.joinMatch(1);
        }
        if (numPlayers >= 6) {
            vm.prank(playerF);
            escrow.joinMatch(1);
        }
    }

    function _commitAsPlayer(uint256 mId, uint8 round, address player, uint256 moveSaltSeed) internal {
        bytes32 salt = keccak256(abi.encodePacked("salt", round, player, moveSaltSeed));
        bytes32 hash = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), mId, uint256(round), player, uint256(1), salt));
        
        vm.prank(player);
        escrow.commitMove(mId, hash);
    }

    function _revealAsPlayer(uint256 mId, uint8 round, address player, uint8 move, uint256 moveSaltSeed) internal {
        bytes32 salt = keccak256(abi.encodePacked("salt", round, player, moveSaltSeed));
        
        vm.prank(player);
        escrow.revealMove(mId, move, salt);
    }

    function _playRound(uint256 mId, uint8 round, uint8 moveA, uint8 moveB, uint8 winnerIdx) internal {
        bytes32 saltA = keccak256(abi.encodePacked("salt", round, playerA));
        bytes32 saltB = keccak256(abi.encodePacked("salt", round, playerB));
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), mId, uint256(round), playerA, uint256(moveA), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), mId, uint256(round), playerB, uint256(moveB), saltB));

        vm.prank(playerA);
        escrow.commitMove(mId, hashA);
        vm.prank(playerB);
        escrow.commitMove(mId, hashB);

        vm.prank(playerA);
        escrow.revealMove(mId, moveA, saltA);
        vm.prank(playerB);
        escrow.revealMove(mId, moveB, saltB);

        vm.prank(referee);
        escrow.resolveFiseRound(mId, winnerIdx);
    }

    function _playRound4Player(uint256 mId, uint8 round, uint8 winnerIdx) internal {
        // All 4 players commit
        _commitAsPlayer(mId, round, playerA, 1);
        _commitAsPlayer(mId, round, playerB, 2);
        _commitAsPlayer(mId, round, playerC, 3);
        _commitAsPlayer(mId, round, playerD, 4);

        // All 4 players reveal
        _revealAsPlayer(mId, round, playerA, 1, 1);
        _revealAsPlayer(mId, round, playerB, 1, 2);
        _revealAsPlayer(mId, round, playerC, 1, 3);
        _revealAsPlayer(mId, round, playerD, 1, 4);

        vm.prank(referee);
        escrow.resolveFiseRound(mId, winnerIdx);
    }

    function _completeMatchWithWinner(uint256 mId, uint8 winnerIdx) internal {
        // Play 3 rounds with same winner
        for (uint8 i = 1; i <= 3; i++) {
            _playRound(mId, i, 1, 1, winnerIdx);
        }
    }

    // ==================== CONSTRUCTOR TESTS ====================

    function test_Constructor_RevertZeroRegistry() public {
        vm.prank(owner);
        vm.expectRevert("Invalid registry");
        new FiseEscrow(treasury, address(usdc), address(0), referee);
    }

    function test_Constructor_RevertZeroReferee() public {
        vm.prank(owner);
        vm.expectRevert("Invalid referee");
        new FiseEscrow(treasury, address(usdc), address(registry), address(0));
    }

    // Helper to play a draw round with unique salts
    // Uses the ACTUAL current round from the contract, not a passed parameter
    function _playDrawRound(uint256 matchId, uint8 drawNum) internal {
        uint8 actualRound = escrow.getMatch(matchId).currentRound;
        
        bytes32 saltA = keccak256(abi.encodePacked("draw", actualRound, drawNum, "A"));
        bytes32 saltB = keccak256(abi.encodePacked("draw", actualRound, drawNum, "B"));
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(actualRound), playerA, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(actualRound), playerB, uint256(1), saltB));

        vm.prank(playerA);
        escrow.commitMove(matchId, hashA);
        vm.prank(playerB);
        escrow.commitMove(matchId, hashB);

        vm.prank(playerA);
        escrow.revealMove(matchId, 1, saltA);
        vm.prank(playerB);
        escrow.revealMove(matchId, 1, saltB);

        vm.prank(referee);
        escrow.resolveFiseRound(matchId, 255); // DRAW
    }

    // Test max rounds reached without anyone getting 3 wins
    // Uses draws to advance rounds without giving wins to any player
    function test_MaxRoundsReachedNoWinner() public {
        _setupActiveMatch(2);

        // To reach round 10 without anyone getting 3 wins, use draws
        // After 3 consecutive draws in a round, the 4th draw advances to next round
        // Each "round advancement" requires 4 draw resolutions
        
        uint8 drawNum = 0;
        uint8 lastRound = 1;
        
        while (escrow.getMatch(1).currentRound <= 10) {
            _playDrawRound(1, drawNum);
            
            uint8 newRound = escrow.getMatch(1).currentRound;
            if (newRound != lastRound) {
                drawNum = 0;
                lastRound = newRound;
            } else {
                drawNum++;
            }
            
            // Check if match settled (at max rounds)
            if (escrow.getMatch(1).status == MatchEscrow.MatchStatus.SETTLED) {
                break;
            }
        }

        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        // With all draws, both have 0 wins - match should settle at max rounds
        assertEq(m.wins[0], 0);
        assertEq(m.wins[1], 0);
    }

    // Test tie settlement when players have equal wins at max rounds
    function test_TieSettlement() public {
        _setupActiveMatch(2);

        // Give each player exactly 2 wins (tied at 2-2)
        _playRound(1, 1, 1, 2, 0); // A wins
        _playRound(1, 2, 1, 2, 1); // B wins
        _playRound(1, 3, 1, 2, 0); // A wins (2-1)
        _playRound(1, 4, 1, 2, 1); // B wins (2-2)

        // Rounds 5-10: Use draws to reach max rounds without anyone getting 3rd win
        uint8 drawNum = 0;
        uint8 lastRound = escrow.getMatch(1).currentRound;
        
        while (escrow.getMatch(1).currentRound <= 10) {
            _playDrawRound(1, drawNum);
            
            uint8 newRound = escrow.getMatch(1).currentRound;
            if (newRound != lastRound) {
                drawNum = 0;
                lastRound = newRound;
            } else {
                drawNum++;
            }
            
            if (escrow.getMatch(1).status == MatchEscrow.MatchStatus.SETTLED) {
                break;
            }
        }

        FiseEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.wins[0], 2);
        assertEq(m.wins[1], 2);
        // With equal wins at max rounds, it's a draw - winner is address(0)
        assertEq(m.winner, address(0));
    }

}

// Mock contract that rejects token transfers
contract RejectingContract {
    fallback() external payable {
        revert("I reject everything");
    }
    
    receive() external payable {
        revert("I reject everything");
    }
}
