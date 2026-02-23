// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/logic/SimpleDice.sol";

contract SimpleDiceTest is Test {
    SimpleDice public dice;

    function setUp() public {
        dice = new SimpleDice();
    }

    function testResolveRound() public {
        // Tie
        assertEq(dice.resolveRound(1, 1), 0);
        assertEq(dice.resolveRound(6, 6), 0);

        // Player 1 wins
        assertEq(dice.resolveRound(2, 1), 1);
        assertEq(dice.resolveRound(6, 5), 1);

        // Player 2 wins
        assertEq(dice.resolveRound(1, 2), 2);
        assertEq(dice.resolveRound(5, 6), 2);
    }

    function testMoveName() public {
        assertEq(dice.moveName(1), "ONE");
        assertEq(dice.moveName(2), "TWO");
        assertEq(dice.moveName(3), "THREE");
        assertEq(dice.moveName(4), "FOUR");
        assertEq(dice.moveName(5), "FIVE");
        assertEq(dice.moveName(6), "SIX");
        assertEq(dice.moveName(0), "UNKNOWN");
        assertEq(dice.moveName(7), "UNKNOWN");
    }

    function testMetadata() public {
        assertEq(dice.gameType(), "SIMPLE_DICE");
    }

    function testIsValidMove() public {
        assertTrue(dice.isValidMove(1));
        assertTrue(dice.isValidMove(3));
        assertTrue(dice.isValidMove(6));
        assertFalse(dice.isValidMove(0));
        assertFalse(dice.isValidMove(7));
    }
}
