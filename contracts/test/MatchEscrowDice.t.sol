// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/MatchEscrow.sol";
import "../src/logic/SimpleDice.sol";

contract MatchEscrowDiceTest is Test {
    MatchEscrow public escrow;
    SimpleDice public dice;
    address public treasury = address(0x123);
    address public playerA = address(0x111);
    address public playerB = address(0x222);

    uint256 public constant STAKE = 1 ether;

    function setUp() public {
        escrow = new MatchEscrow(treasury);
        dice = new SimpleDice();
        escrow.approveGameLogic(address(dice), true);
        vm.deal(playerA, 10 ether);
        vm.deal(playerB, 10 ether);
    }

    function testFullGameLoopDice() public {
        // Create
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(dice));

        // Join
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        // Round 1: Player A (6), Player B (1) -> A wins
        uint8 moveA = 6;
        uint8 moveB = 1;
        bytes32 saltA = keccak256("saltA1");
        bytes32 saltB = keccak256("saltB1");
        bytes32 hashA = keccak256(abi.encodePacked(uint256(1), uint8(1), playerA, moveA, saltA));
        bytes32 hashB = keccak256(abi.encodePacked(uint256(1), uint8(1), playerB, moveB, saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, moveA, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, moveB, saltB);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 1);
        assertEq(m.winsB, 0);
        assertEq(m.currentRound, 2);
        assertEq(uint(m.phase), uint(MatchEscrow.Phase.COMMIT));

        // Round 2: Player A (3), Player B (5) -> B wins
        moveA = 3;
        moveB = 5;
        saltA = keccak256("saltA2");
        saltB = keccak256("saltB2");
        hashA = keccak256(abi.encodePacked(uint256(1), uint8(2), playerA, moveA, saltA));
        hashB = keccak256(abi.encodePacked(uint256(1), uint8(2), playerB, moveB, saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, moveA, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, moveB, saltB);

        m = escrow.getMatch(1);
        assertEq(m.winsA, 1);
        assertEq(m.winsB, 1);
        assertEq(m.currentRound, 3);

        // Round 3: Player A (6), Player B (2) -> A wins Match
        moveA = 6;
        moveB = 2;
        saltA = keccak256("saltA3");
        saltB = keccak256("saltB3");
        hashA = keccak256(abi.encodePacked(uint256(1), uint8(3), playerA, moveA, saltA));
        hashB = keccak256(abi.encodePacked(uint256(1), uint8(3), playerB, moveB, saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        uint256 balBeforeA = playerA.balance;
        
        vm.prank(playerA);
        escrow.revealMove(1, moveA, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, moveB, saltB);

        m = escrow.getMatch(1);
        assertEq(m.winsA, 2);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        
        uint256 totalPot = STAKE * 2;
        uint256 rake = (totalPot * 500) / 10000;
        uint256 payout = totalPot - rake;
        assertEq(playerA.balance, balBeforeA + payout);
    }
}
