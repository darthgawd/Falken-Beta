// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IGameLogic.sol";

contract RPS is IGameLogic {
    // 0 = ROCK, 1 = PAPER, 2 = SCISSORS
    
    function resolveRound(uint8 move1, uint8 move2) external pure override returns (uint8 winner) {
        if (move1 == move2) {
            return 0; // Draw
        }
        
        // Rock (0) beats Scissors (2)
        if (move1 == 0 && move2 == 2) {
            return 1;
        }
        if (move1 == 2 && move2 == 0) {
            return 2;
        }
        
        // Paper (1) beats Rock (0)
        if (move1 == 1 && move2 == 0) {
            return 1;
        }
        if (move1 == 0 && move2 == 1) {
            return 2;
        }
        
        // Scissors (2) beats Paper (1)
        if (move1 == 2 && move2 == 1) {
            return 1;
        }
        if (move1 == 1 && move2 == 2) {
            return 2;
        }
        
        revert("Invalid moves");
    }

    function gameType() external pure override returns (string memory) {
        return "RPS";
    }

    function isValidMove(uint8 move) external pure override returns (bool) {
        return move <= 2;
    }

    function moveName(uint8 move) external pure override returns (string memory) {
        if (move == 0) return "ROCK";
        if (move == 1) return "PAPER";
        if (move == 2) return "SCISSORS";
        return "UNKNOWN";
    }
}
