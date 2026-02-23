// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IGameLogic.sol";

/**
 * @title SimpleDice
 * @notice A high-roll dice game for the BASEBIT Arena.
 * Players commit a hidden number (1-6). Higher roll wins.
 */
contract SimpleDice is IGameLogic {
    function resolveRound(uint8 move1, uint8 move2) external pure override returns (uint8) {
        if (move1 == move2) return 0; // Draw
        return move1 > move2 ? 1 : 2;
    }

    function moveName(uint8 move) external pure override returns (string memory) {
        if (move == 1) return "ONE";
        if (move == 2) return "TWO";
        if (move == 3) return "THREE";
        if (move == 4) return "FOUR";
        if (move == 5) return "FIVE";
        if (move == 6) return "SIX";
        return "UNKNOWN";
    }

    function gameType() external pure override returns (string memory) {
        return "SIMPLE_DICE";
    }

    function isValidMove(uint8 move) external pure override returns (bool) {
        return move >= 1 && move <= 6;
    }
}
