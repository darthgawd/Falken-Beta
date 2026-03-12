// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IBaseEscrow
 * @dev Interface for the BaseEscrow contract - shared money layer
 */
interface IBaseEscrow {

    // --- ENUMS ---
    enum MatchStatus { OPEN, ACTIVE, SETTLED, VOIDED }

    // --- STRUCTS ---
    struct BaseMatch {
        address[] players;
        uint256 stake;
        uint256 totalPot;
        bytes32 logicId;
        uint8 maxPlayers;
        uint8 maxRounds;
        uint8 currentRound;
        uint8[] wins;
        uint8 drawCounter;
        uint8 winsRequired;
        MatchStatus status;
        address winner;
        uint256 createdAt;
    }

    struct Resolution {
        uint8[] winnerIndices;
        uint256[] splitBps;
    }

    // --- EVENTS ---
    event MatchCreated(
        uint256 indexed matchId,
        address indexed creator,
        uint256 stake,
        bytes32 indexed logicId,
        uint8 maxPlayers,
        uint8 maxRounds
    );

    event PlayerJoined(
        uint256 indexed matchId,
        address indexed player,
        uint8 playerIndex
    );

    event PlayerLeft(
        uint256 indexed matchId,
        address indexed player
    );

    event MatchSettled(
        uint256 indexed matchId,
        uint8[] winnerIndices,
        uint256 payout,
        uint256 rake
    );

    event MatchVoided(
        uint256 indexed matchId,
        string reason
    );

    event TimeoutClaimed(
        uint256 indexed matchId,
        address indexed claimer,
        uint8 winnerIndex
    );

    event WithdrawalQueued(
        address indexed user,
        uint256 amount
    );

    event WithdrawalClaimed(
        address indexed user,
        uint256 amount
    );

    event MatchActivated(
        uint256 indexed matchId
    );

    event TreasuryUpdated(
        address indexed oldTreasury,
        address indexed newTreasury
    );

    // --- FUNCTIONS ---
    function joinMatch(uint256 matchId) external;
    function leaveMatch(uint256 matchId) external;
    function claimTimeout(uint256 matchId) external;
    function mutualTimeout(uint256 matchId) external;
    function claimExpiredMatch(uint256 matchId) external;
    function withdraw() external;
    function adminVoidMatch(uint256 matchId) external;
    function setTreasury(address newTreasury) external;
    function pause() external;
    function unpause() external;

    function getMatch(uint256 matchId) external view returns (BaseMatch memory);
    function getMatchWinner(uint256 matchId) external view returns (address);

    function playerContributions(uint256 matchId, address player) external view returns (uint256);
    function pendingWithdrawals(address user) external view returns (uint256);
    function matchCounter() external view returns (uint256);
    function treasury() external view returns (address);
    function usdc() external view returns (IERC20);

    // --- CONSTANTS ---
    function RAKE_BPS() external pure returns (uint256);
    function MIN_STAKE() external pure returns (uint256);
    function JOIN_WINDOW() external pure returns (uint256);
}
