// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/MatchEscrow.sol";
import "../src/games/RPS.sol";

contract RevertingReceiver {
    receive() external payable {
        revert("I refuse ETH");
    }
}

contract NonPayableReceiver {
    fallback() external { }
}

contract MatchEscrowTest is Test {
    MatchEscrow public escrow;
    RPS public rps;
    address public treasury = address(0x123);
    address public playerA = address(0x111);
    address public playerB = address(0x222);
    address public stranger = address(0x333);

    uint256 public constant STAKE = 1 ether;

    function setUp() public {
        escrow = new MatchEscrow(treasury);
        rps = new RPS();
        escrow.approveGameLogic(address(rps), true);
        vm.deal(playerA, 10 ether);
        vm.deal(playerB, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    function test_RevertIf_ConstructorInvalidTreasury() public {
        vm.expectRevert("Invalid treasury");
        new MatchEscrow(address(0));
    }

    // --- Core Match Management ---

    function testCreateMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        (address pA, , uint256 s, , , , , , MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(pA, playerA);
        assertEq(s, STAKE);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.OPEN));
    }

    function test_RevertIf_CreateMatchInvalidStake() public {
        vm.prank(playerA);
        vm.expectRevert("Incorrect stake amount");
        escrow.createMatch{value: 0.5 ether}(STAKE, address(rps));
    }

    function test_RevertIf_CreateMatchZeroStake() public {
        vm.prank(playerA);
        vm.expectRevert("Stake must be non-zero");
        escrow.createMatch{value: 0}(0, address(rps));
    }

    function test_RevertIf_CreateMatchLogicNotApproved() public {
        vm.prank(playerA);
        vm.expectRevert("Game logic not approved");
        escrow.createMatch{value: STAKE}(STAKE, address(0x999));
    }

    function testJoinMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        (, address pB, , , , , , , MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(pB, playerB);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.ACTIVE));
    }

    function test_RevertIf_JoinMatchInvalidStake() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        vm.expectRevert("Incorrect stake amount");
        escrow.joinMatch{value: 0.5 ether}(1);
    }

    function test_RevertIf_JoinMatchSelf() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerA);
        vm.expectRevert("Cannot play against yourself");
        escrow.joinMatch{value: STAKE}(1);
    }

    function test_RevertIf_JoinActiveMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(stranger);
        vm.expectRevert("Match not open");
        escrow.joinMatch{value: STAKE}(1);
    }

    function testCancelMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerA);
        escrow.cancelMatch(1);
        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function test_RevertIf_CancelMatchNotCreator() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(stranger);
        vm.expectRevert("Not match creator");
        escrow.cancelMatch(1);
    }

    function test_RevertIf_CancelActiveMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        vm.expectRevert("Match not open");
        escrow.cancelMatch(1);
    }

    // --- Commit / Reveal Logic ---

    function testCommitDeadline() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Commit deadline passed");
        escrow.commitMove(1, keccak256("hash"));
    }

    function test_RevertIf_CommitTwice() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        escrow.commitMove(1, keccak256("hash1"));
        vm.prank(playerA);
        vm.expectRevert("Already committed");
        escrow.commitMove(1, keccak256("hash2"));
    }

    function test_RevertIf_CommitNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        vm.prank(playerA);
        vm.expectRevert("Match not active");
        escrow.commitMove(1, keccak256("hash"));
    }

    function test_RevertIf_CommitNotParticipant() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(stranger);
        vm.expectRevert("Not a participant");
        escrow.commitMove(1, keccak256("hash"));
    }

    function test_RevertIf_CommitNotInCommitPhase() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        escrow.commitMove(1, keccak256("a"));
        vm.prank(playerB);
        escrow.commitMove(1, keccak256("b"));
        // Now in Reveal phase

        vm.prank(playerA);
        vm.expectRevert("Not in commit phase");
        escrow.commitMove(1, keccak256("c"));
    }

    function testRevealValidation() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint256(1), uint8(1), playerA, uint8(1), salt));
        
        vm.prank(playerA); escrow.commitMove(1, hash);
        vm.prank(playerB); escrow.commitMove(1, keccak256("b"));

        vm.prank(playerA);
        vm.expectRevert("Invalid reveal");
        escrow.revealMove(1, 2, salt); // Wrong move
    }

    function test_RevertIf_RevealTwice() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint256(1), uint8(1), playerA, uint8(1), salt));
        bytes32 hashB = keccak256(abi.encodePacked(uint256(1), uint8(1), playerB, uint8(1), salt));
        
        vm.prank(playerA); escrow.commitMove(1, hash);
        vm.prank(playerB); escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, 1, salt);
        vm.prank(playerA);
        vm.expectRevert("Already revealed");
        escrow.revealMove(1, 1, salt);
    }

    function test_RevertIf_RevealNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        vm.prank(playerA);
        vm.expectRevert("Match not active");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealNotInRevealPhase() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        vm.expectRevert("Not in reveal phase");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealDeadlinePassed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA); escrow.commitMove(1, keccak256("a"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("b"));

        vm.warp(block.timestamp + 2 hours);

        vm.prank(playerA);
        vm.expectRevert("Reveal deadline passed");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealNotParticipant() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA); escrow.commitMove(1, keccak256("a"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("b"));

        vm.prank(stranger);
        vm.expectRevert("Not a participant");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealInvalidMove() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        bytes32 salt = keccak256("salt");
        uint8 invalidMove = 5;
        bytes32 hash = keccak256(abi.encodePacked(uint256(1), uint8(1), playerA, invalidMove, salt));
        
        vm.prank(playerA); escrow.commitMove(1, hash);
        vm.prank(playerB); escrow.commitMove(1, keccak256("b"));

        vm.prank(playerA);
        vm.expectRevert("Invalid move");
        escrow.revealMove(1, invalidMove, salt);
    }

    // --- Timeout Logic ---

    function testClaimTimeoutCommit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        escrow.commitMove(1, keccak256("a"));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        escrow.claimTimeout(1);

        (,,,,uint8 winsA, , , , MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(winsA, 2);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function test_RevertIf_ClaimTimeoutNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerA);
        vm.expectRevert("Match not active");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutNotParticipant() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(stranger);
        vm.expectRevert("Not a participant");
        escrow.claimTimeout(1);
    }

    function testClaimTimeoutReveal() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint256(1), uint8(1), playerA, uint8(1), salt));
        
        vm.prank(playerA); escrow.commitMove(1, hash);
        vm.prank(playerB); escrow.commitMove(1, keccak256("b"));

        vm.prank(playerA);
        escrow.revealMove(1, 1, salt);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        escrow.claimTimeout(1);

        (,,,,uint8 winsA, , , , MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(winsA, 2);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function testClaimTimeoutCommitAsPlayerB() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerB);
        escrow.commitMove(1, keccak256("b"));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerB);
        escrow.claimTimeout(1);

        (,,,,,uint8 winsB, , , MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(winsB, 2);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function test_RevertIf_ClaimTimeoutTooEarlyCommit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        escrow.commitMove(1, keccak256("a"));

        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutYouDidNotCommit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("You did not commit");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutTooEarlyReveal() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        // Both commit to move to REVEAL phase
        vm.prank(playerA); escrow.commitMove(1, keccak256("a"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("b"));

        // Do NOT fast forward time, so reveal deadline has not passed.
        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutYouDidNotReveal() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        escrow.commitMove(1, keccak256("a"));
        vm.prank(playerB);
        escrow.commitMove(1, keccak256("b"));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("You did not reveal");
        escrow.claimTimeout(1);
    }

    function testMutualTimeoutCommit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.warp(block.timestamp + 2 hours);
        escrow.mutualTimeout(1);
        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function test_RevertIf_MutualTimeoutNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.expectRevert("Match not active");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutNotMet() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        
        vm.prank(playerA);
        escrow.commitMove(1, keccak256("a"));

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert("Mutual timeout not met");
        escrow.mutualTimeout(1);
    }

    function testMutualTimeoutReveal() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA); escrow.commitMove(1, keccak256("a"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("b"));

        vm.warp(block.timestamp + 2 hours);
        escrow.mutualTimeout(1);
        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testOddWeiRefund() public {
        uint256 oddStake = 51; // Odd number
        vm.deal(playerA, oddStake);
        vm.deal(playerB, oddStake);

        vm.prank(playerA);
        escrow.createMatch{value: oddStake}(oddStake, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: oddStake}(1);

        vm.warp(block.timestamp + 2 hours);
        escrow.mutualTimeout(1); // Should not revert due to odd-wei rounding
        
        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testSmallStakeMutualTimeout() public {
        uint256 smallStake = 1;
        vm.deal(playerA, smallStake);
        vm.deal(playerB, smallStake);

        vm.prank(playerA);
        escrow.createMatch{value: smallStake}(smallStake, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: smallStake}(1);

        vm.warp(block.timestamp + 2 hours);
        escrow.mutualTimeout(1); // Should not revert, and should call _safeTransfer with amount 0 for the penalty
        
        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    // --- Pull Payments ---

    function testWithdraw() public {
        RevertingReceiver badA = new RevertingReceiver();
        vm.deal(address(badA), 1 ether);
        vm.prank(address(badA));
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(address(badA));
        escrow.cancelMatch(1);

        uint256 pending = escrow.pendingWithdrawals(address(badA));
        assertTrue(pending > 0);
        
        vm.prank(address(badA));
        vm.expectRevert("Withdrawal failed");
        escrow.withdraw();
    }

    function test_RevertIf_WithdrawNothing() public {
        vm.prank(stranger);
        vm.expectRevert("Nothing to withdraw");
        escrow.withdraw();
    }

    function test_RevertIf_WithdrawalFails() public {
        NonPayableReceiver badA = new NonPayableReceiver();
        vm.deal(address(badA), 1 ether);
        vm.prank(address(badA));
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(address(badA));
        escrow.cancelMatch(1);

        uint256 pending = escrow.pendingWithdrawals(address(badA));
        assertTrue(pending > 0);
        
        vm.prank(address(badA));
        vm.expectRevert("Withdrawal failed");
        escrow.withdraw();
    }

    function testGetMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.playerA, playerA);
        assertEq(m.stake, STAKE);
    }

    // --- Admin Functions ---

    function testOwnerFunctions() public {
        escrow.setTreasury(address(0x444));
        assertEq(escrow.treasury(), address(0x444));

        vm.expectRevert("Invalid treasury");
        escrow.setTreasury(address(0));

        escrow.approveGameLogic(address(0x555), true);
        assertTrue(escrow.approvedGameLogic(address(0x555)));

        vm.expectRevert("Invalid logic address");
        escrow.approveGameLogic(address(0), true);
    }

    function test_RevertIf_NotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setTreasury(stranger);

        vm.prank(stranger);
        vm.expectRevert();
        escrow.approveGameLogic(address(0x555), true);
    }

    function testAdminVoidMatchWithPlayerB() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        
        escrow.adminVoidMatch(1);
        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testAdminVoidMatchOpen() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        escrow.adminVoidMatch(1);
        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function test_RevertIf_AdminVoidSettledMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        _playRound(1, 1, 1, 0); // A wins
        _playRound(1, 2, 1, 0); // A wins, settles match

        vm.expectRevert("Match not voidable");
        escrow.adminVoidMatch(1);
    }

    function testPausability() public {
        escrow.pause();
        vm.prank(playerA);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        escrow.createMatch{value: STAKE}(STAKE, address(rps));

        escrow.unpause();
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
    }

    // --- Game Logic ---

    function testRPSLogic() public {
        assertEq(rps.resolveRound(0, 2), 1); // Rock beats Sci
        assertEq(rps.resolveRound(2, 0), 2);
        assertEq(rps.resolveRound(1, 0), 1); // Paper beats Rock
        assertEq(rps.resolveRound(0, 1), 2);
        assertEq(rps.resolveRound(2, 1), 1); // Sci beats Paper
        assertEq(rps.resolveRound(1, 2), 2);
        assertEq(rps.resolveRound(1, 1), 0); // Draw
        
        assertTrue(rps.isValidMove(0));
        assertTrue(rps.isValidMove(1));
        assertTrue(rps.isValidMove(2));
        assertFalse(rps.isValidMove(3));
    }

    function testFullGameLoop() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        _playRound(1, 1, 1, 0); // A wins
        _playRound(1, 2, 1, 0); // A wins

        (,,,,uint8 winsA, , , , MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(winsA, 2);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function testFullGameLoopPlayerBWin() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        _playRound(1, 1, 0, 1); // B wins
        _playRound(1, 2, 0, 1); // B wins

        (,,,,,uint8 winsB, , , MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(winsB, 2);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function test_RevertIf_SettleMatchTreasuryFails() public {
        RevertingReceiver badTreasury = new RevertingReceiver();
        escrow.setTreasury(address(badTreasury));

        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        _playRound(1, 1, 1, 0); // A wins round 1

        // Manually play round 2 to catch the revert
        uint256 mId = 1;
        uint8 round = 2;
        uint8 moveA = 1;
        uint8 moveB = 0;

        bytes32 saltA = keccak256(abi.encodePacked("saltA", round));
        bytes32 saltB = keccak256(abi.encodePacked("saltB", round));
        bytes32 hashA = keccak256(abi.encodePacked(mId, round, playerA, moveA, saltA));
        bytes32 hashB = keccak256(abi.encodePacked(mId, round, playerB, moveB, saltB));
        vm.prank(playerA); escrow.commitMove(mId, hashA);
        vm.prank(playerB); escrow.commitMove(mId, hashB);
        vm.prank(playerA); escrow.revealMove(mId, moveA, saltA);

        vm.expectRevert("Treasury payment failed");
        vm.prank(playerB); escrow.revealMove(mId, moveB, saltB); // This should trigger settlement and revert
    }

    function testDrawAndMaxRounds() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        for(uint8 i=1; i<=5; i++) {
            _playRound(1, i, 0, 0); // 5 Draws
        }

        (,,,,,,,, MatchEscrow.MatchStatus status, , ) = escrow.matches(1);
        assertEq(uint(status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function testGetRoundStatus() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        escrow.commitMove(1, keccak256("hash"));
        (bytes32 h, bool r) = escrow.getRoundStatus(1, 1, playerA);
        assertEq(h, keccak256("hash"));
        assertFalse(r);
    }

    function _playRound(uint256 mId, uint8 round, uint8 moveA, uint8 moveB) internal {
        bytes32 saltA = keccak256(abi.encodePacked("saltA", round));
        bytes32 saltB = keccak256(abi.encodePacked("saltB", round));
        bytes32 hashA = keccak256(abi.encodePacked(mId, round, playerA, moveA, saltA));
        bytes32 hashB = keccak256(abi.encodePacked(mId, round, playerB, moveB, saltB));
        vm.prank(playerA); escrow.commitMove(mId, hashA);
        vm.prank(playerB); escrow.commitMove(mId, hashB);
        vm.prank(playerA); escrow.revealMove(mId, moveA, saltA);
        vm.prank(playerB); escrow.revealMove(mId, moveB, saltB);
    }
}
