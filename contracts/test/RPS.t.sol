// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/games/RPS.sol";

contract RPSTest is Test {
    RPS public rps;

    function setUp() public {
        rps = new RPS();
    }

    function testResolveRound() public {
        // 0=Rock, 1=Paper, 2=Scissors
        // Winner 0=Draw, 1=P1, 2=P2
        
        // Rock cases
        assertEq(rps.resolveRound(0, 0), 0);
        assertEq(rps.resolveRound(0, 1), 2);
        assertEq(rps.resolveRound(0, 2), 1);

        // Paper cases
        assertEq(rps.resolveRound(1, 0), 1);
        assertEq(rps.resolveRound(1, 1), 0);
        assertEq(rps.resolveRound(1, 2), 2);

        // Scissors cases
        assertEq(rps.resolveRound(2, 0), 2);
        assertEq(rps.resolveRound(2, 1), 1);
        assertEq(rps.resolveRound(2, 2), 0);
    }

    function test_RevertIf_InvalidMoves() public {
        // We bypass the escrow here to hit the internal reverts
        vm.expectRevert("Invalid moves");
        rps.resolveRound(3, 0);

        vm.expectRevert("Invalid moves");
        rps.resolveRound(0, 3);
    }

    function testMetadata() public {
        assertEq(rps.gameType(), "RPS");
        assertTrue(rps.isValidMove(0));
        assertTrue(rps.isValidMove(1));
        assertTrue(rps.isValidMove(2));
        assertFalse(rps.isValidMove(3));
    }

    function testMoveName() public {
        assertEq(rps.moveName(0), "ROCK");
        assertEq(rps.moveName(1), "PAPER");
        assertEq(rps.moveName(2), "SCISSORS");
        assertEq(rps.moveName(3), "UNKNOWN");
    }
}
