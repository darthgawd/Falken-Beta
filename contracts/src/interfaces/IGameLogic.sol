// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGameLogic {
    /**
     * @notice Resolves a round between two players.
     * @param move1 The move made by player 1.
     * @param move2 The move made by player 2.
     * @return winner The winner of the round (0 = draw, 1 = player 1, 2 = player 2).
     */
    function resolveRound(uint8 move1, uint8 move2) external pure returns (uint8 winner);

    /**
     * @notice Returns a human-readable name for a move index.
     */
    function moveName(uint8 move) external pure returns (string memory);

    /**
     * @notice Returns the type of game.
     */
    function gameType() external view returns (string memory);

    /**
     * @notice Validates if a move is valid for the game.
     */
    function isValidMove(uint8 move) external pure returns (bool);
}
