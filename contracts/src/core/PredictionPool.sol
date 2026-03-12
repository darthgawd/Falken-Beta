// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IBaseEscrow.sol";

/**
 * @title PredictionPool
 * @dev Parimutuel betting pools for spectator predictions on match outcomes.
 * Does NOT inherit BaseEscrow - completely standalone contract.
 * Supports both match-linked pools (auto-resolution) and standalone predictions (manual resolution).
 *
 * SECURITY NOTES:
 * - authorizedEscrows whitelist prevents fake escrow attacks
 * - bettingDeadline prevents information advantage (bets close before match resolution)
 * - ReentrancyGuard on all fund-moving functions
 * - Pull-payment fallback for failed USDC transfers
 * - Draws result in full refunds (no rake)
 */
contract PredictionPool is ReentrancyGuard, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    // --- CONSTANTS ---
    uint256 public constant RAKE_BPS = 500; // 5% rake on winning pools
    uint256 public constant MIN_BET = 100_000; // 0.10 USDC (6 decimals)
    uint256 public constant MAX_OUTCOMES = 10; // Maximum outcomes per pool

    // --- STATE VARIABLES ---
    IERC20 public immutable usdc;
    address public treasury;
    uint256 public poolCounter;

    // Whitelist of authorized escrow contracts (prevents fake escrow attacks)
    mapping(address => bool) public authorizedEscrows;

    // Pool storage
    mapping(uint256 => Pool) public pools;

    // bets[poolId][bettor][outcomeIndex] = amount
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public bets;

    // Track if a bettor has claimed winnings for a pool
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    // --- STRUCTS ---
    struct Pool {
        address escrowAddress;      // which escrow contract (address(0) for standalone)
        uint256 matchId;            // which match (0 for standalone)
        uint256 bettingDeadline;    // bets close after this timestamp
        uint256 totalPool;          // all bets combined
        uint256[] outcomeTotals;    // total bet per outcome
        bool resolved;              // has the pool been settled
        uint8 winningOutcome;       // which outcome won (set on resolution)
        bool isDraw;                // if true, all bets refunded
        string title;               // prediction title (e.g., "Who will win?")
        string[] outcomeLabels;     // human-readable labels for each outcome
    }

    // --- EVENTS ---
    event PoolCreated(
        uint256 indexed poolId,
        address indexed escrowAddress,
        uint256 indexed matchId,
        uint256 bettingDeadline,
        string title,
        string[] outcomeLabels
    );

    event BetPlaced(
        uint256 indexed poolId,
        address indexed bettor,
        uint8 outcomeIndex,
        uint256 amount
    );

    event PoolResolved(
        uint256 indexed poolId,
        uint8 winningOutcome,
        uint256 totalPool,
        uint256 rake
    );

    event PoolResolvedDraw(
        uint256 indexed poolId,
        uint256 totalPool
    );

    event WinningsClaimed(
        uint256 indexed poolId,
        address indexed bettor,
        uint256 amount
    );

    event RefundClaimed(
        uint256 indexed poolId,
        address indexed bettor,
        uint256 amount
    );

    event TreasuryUpdated(
        address indexed oldTreasury,
        address indexed newTreasury
    );

    event EscrowAuthorized(
        address indexed escrow
    );

    event EscrowDeauthorized(
        address indexed escrow
    );

    // --- CONSTRUCTOR ---
    constructor(
        address initialTreasury,
        address usdcAddress
    ) Ownable(msg.sender) {
        require(initialTreasury != address(0), "Invalid treasury");
        require(usdcAddress != address(0), "Invalid USDC");
        treasury = initialTreasury;
        usdc = IERC20(usdcAddress);
    }

    // --- POOL CREATION ---

    /**
     * @dev Create a new prediction pool.
     * For match-linked pools: set escrowAddress and matchId
     * For standalone pools: set escrowAddress = address(0) and matchId = 0
     *
     * @param escrowAddress The escrow contract address (address(0) for standalone)
     * @param matchId The match ID (0 for standalone)
     * @param bettingDeadline Timestamp when betting closes
     * @param title Human-readable prediction title
     * @param outcomeLabels Array of outcome labels (e.g., ["Joshua", "David", "Draw"])
     */
    function createPool(
        address escrowAddress,
        uint256 matchId,
        uint256 bettingDeadline,
        string calldata title,
        string[] calldata outcomeLabels
    ) external onlyOwner returns (uint256 poolId) {
        require(bettingDeadline > block.timestamp, "Deadline must be in future");
        require(outcomeLabels.length >= 2, "Need at least 2 outcomes");
        require(outcomeLabels.length <= MAX_OUTCOMES, "Too many outcomes");
        require(bytes(title).length > 0, "Title required");
        require(bytes(title).length <= 200, "Title too long");

        // Validate escrow is authorized (for match-linked pools)
        if (escrowAddress != address(0)) {
            require(authorizedEscrows[escrowAddress], "Escrow not authorized");
            require(matchId > 0, "Invalid match ID");
        }

        poolId = ++poolCounter;

        Pool storage p = pools[poolId];
        p.escrowAddress = escrowAddress;
        p.matchId = matchId;
        p.bettingDeadline = bettingDeadline;
        p.title = title;
        
        // Manually copy outcomeLabels to avoid calldata-to-storage copy issue
        for (uint i = 0; i < outcomeLabels.length; i++) {
            p.outcomeLabels.push(outcomeLabels[i]);
        }
        
        p.outcomeTotals = new uint256[](outcomeLabels.length);
        p.resolved = false;
        p.isDraw = false;

        emit PoolCreated(
            poolId,
            escrowAddress,
            matchId,
            bettingDeadline,
            title,
            outcomeLabels
        );
    }

    // --- BETTING ---

    /**
     * @dev Place a bet on a specific outcome.
     * Bets cannot be placed after the betting deadline.
     * Minimum bet is 0.10 USDC.
     *
     * @param poolId The pool ID
     * @param outcomeIndex Index of the outcome being bet on
     * @param amount USDC amount to bet
     */
    function placeBet(
        uint256 poolId,
        uint8 outcomeIndex,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        Pool storage p = _requirePoolExists(poolId);

        require(!p.resolved, "Pool already resolved");
        require(block.timestamp <= p.bettingDeadline, "Betting closed");
        require(amount >= MIN_BET, "Bet below minimum");
        require(outcomeIndex < p.outcomeLabels.length, "Invalid outcome");

        // Pull USDC from bettor
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Record bet
        bets[poolId][msg.sender][outcomeIndex] += amount;
        p.outcomeTotals[outcomeIndex] += amount;
        p.totalPool += amount;

        emit BetPlaced(poolId, msg.sender, outcomeIndex, amount);
    }

    // --- POOL RESOLUTION ---

    /**
     * @dev Resolve a match-linked pool by reading winner from escrow.
     * Can be called by anyone after the match is settled.
     * Handles draws automatically: if the match settled with no winner, resolves as draw.
     *
     * @param poolId The pool ID to resolve
     */
    function resolvePool(uint256 poolId) external nonReentrant {
        Pool storage p = _requirePoolExists(poolId);

        require(!p.resolved, "Pool already resolved");
        require(p.escrowAddress != address(0), "Not a match-linked pool");
        require(block.timestamp > p.bettingDeadline, "Betting still open");

        IBaseEscrow escrow = IBaseEscrow(p.escrowAddress);
        address winner = escrow.getMatchWinner(p.matchId);

        if (winner == address(0)) {
            // No winner set — must confirm the match actually settled (not just not resolved yet)
            IBaseEscrow.BaseMatch memory matchData = escrow.getMatch(p.matchId);
            require(matchData.status == IBaseEscrow.MatchStatus.SETTLED, "Match not settled yet");
            // Match settled with no winner = draw
            _resolvePoolAsDraw(poolId);
            return;
        }

        // Find winner index in players array
        IBaseEscrow.BaseMatch memory matchData = escrow.getMatch(p.matchId);
        uint8 winnerIndex = _findWinnerIndex(matchData.players, winner);
        require(winnerIndex < matchData.players.length, "Winner not found in players");

        // Map player index to outcome index (player[0] -> outcome[0], etc.)
        _resolvePoolInternal(poolId, winnerIndex);
    }

    /**
     * @dev Manually resolve a standalone pool (oracle/admin resolution).
     * Only callable by owner. For standalone pools or special cases.
     *
     * @param poolId The pool ID to resolve
     * @param winningOutcome Index of the winning outcome
     */
    function resolvePoolManual(
        uint256 poolId,
        uint8 winningOutcome
    ) external onlyOwner nonReentrant {
        Pool storage p = _requirePoolExists(poolId);

        require(!p.resolved, "Pool already resolved");
        require(winningOutcome < p.outcomeLabels.length, "Invalid outcome");
        require(block.timestamp > p.bettingDeadline, "Betting still open");

        _resolvePoolInternal(poolId, winningOutcome);
    }

    /**
     * @dev Resolve a pool as a draw (all bets refunded, no rake).
     * Only callable by owner. For standalone pools or match-linked pools
     * where the match was voided/cancelled rather than settled.
     *
     * @param poolId The pool ID to resolve as draw
     */
    function resolvePoolDraw(uint256 poolId) external onlyOwner nonReentrant {
        Pool storage p = _requirePoolExists(poolId);

        require(!p.resolved, "Pool already resolved");
        require(block.timestamp > p.bettingDeadline, "Betting still open");

        _resolvePoolAsDraw(poolId);
    }

    // --- WINNINGS CLAIMING ---

    /**
     * @dev Claim winnings for a resolved pool.
     * Winners receive proportional share of pool minus 5% rake.
     * Losers get nothing.
     * Draws: everyone gets full refund.
     *
     * @param poolId The pool ID to claim from
     */
    function claimWinnings(uint256 poolId) external nonReentrant {
        Pool storage p = _requirePoolExists(poolId);

        require(p.resolved, "Pool not resolved");
        require(!hasClaimed[poolId][msg.sender], "Already claimed");

        hasClaimed[poolId][msg.sender] = true;

        if (p.isDraw) {
            _processDrawRefund(poolId, p);
        } else {
            _processWinningPayout(poolId, p);
        }
    }

    // --- ADMIN FUNCTIONS ---

    /**
     * @dev Authorize an escrow contract for match-linked pools.
     */
    function setAuthorizedEscrow(address escrow, bool authorized) external onlyOwner {
        require(escrow != address(0), "Invalid escrow");
        authorizedEscrows[escrow] = authorized;

        if (authorized) {
            emit EscrowAuthorized(escrow);
        } else {
            emit EscrowDeauthorized(escrow);
        }
    }

    /**
     * @dev Update treasury address.
     */
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @dev Pause the contract (emergency).
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause the contract.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Emergency refund for a specific bettor in a pool.
     * Only callable by owner. For edge cases (e.g., blacklisted addresses).
     */
    function emergencyRefund(
        uint256 poolId,
        address bettor,
        uint8 outcomeIndex
    ) external onlyOwner nonReentrant {
        Pool storage p = _requirePoolExists(poolId);
        require(!p.resolved, "Pool already resolved");

        uint256 betAmount = bets[poolId][bettor][outcomeIndex];
        require(betAmount > 0, "No bet to refund");

        // Update state
        bets[poolId][bettor][outcomeIndex] = 0;
        p.outcomeTotals[outcomeIndex] -= betAmount;
        p.totalPool -= betAmount;

        // Transfer refund
        usdc.safeTransfer(bettor, betAmount);

        emit RefundClaimed(poolId, bettor, betAmount);
    }

    // --- VIEW FUNCTIONS ---

    /**
     * @dev Get pool details.
     */
    function getPool(uint256 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    /**
     * @dev Get a bettor's total bet on a specific outcome.
     */
    function getBet(
        uint256 poolId,
        address bettor,
        uint8 outcomeIndex
    ) external view returns (uint256) {
        return bets[poolId][bettor][outcomeIndex];
    }

    /**
     * @dev Get a bettor's bets on all outcomes.
     */
    function getBets(
        uint256 poolId,
        address bettor
    ) external view returns (uint256[] memory) {
        Pool storage p = pools[poolId];
        uint256[] memory betAmounts = new uint256[](p.outcomeLabels.length);
        for (uint8 i = 0; i < p.outcomeLabels.length; i++) {
            betAmounts[i] = bets[poolId][bettor][i];
        }
        return betAmounts;
    }

    /**
     * @dev Calculate potential payout for a bet.
     * Returns the expected payout if the specified outcome wins.
     * Note: This is an estimate based on current pool state.
     */
    function calculatePayout(
        uint256 poolId,
        address bettor,
        uint8 outcomeIndex
    ) external view returns (uint256) {
        Pool storage p = pools[poolId];
        require(outcomeIndex < p.outcomeLabels.length, "Invalid outcome");

        uint256 betAmount = bets[poolId][bettor][outcomeIndex];
        if (betAmount == 0) return 0;

        uint256 winningTotal = p.outcomeTotals[outcomeIndex];
        if (winningTotal == 0) return 0;

        uint256 rake = (p.totalPool * RAKE_BPS) / 10000;
        uint256 remainingPool = p.totalPool - rake;

        return (betAmount * remainingPool) / winningTotal;
    }

    /**
     * @dev Get current implied odds for an outcome.
     * Returns the payout multiplier in basis points (10000 = 1.0x).
     * Formula: totalPool / outcomeTotals[outcome]
     * Example: YES pool $400, NO pool $100, total $500
     *   YES odds = (500 * 10000) / 400 = 12500 (1.25x)
     *   NO odds  = (500 * 10000) / 100 = 50000 (5.0x)
     * Returns 0 if no bets yet. Returns type(uint256).max if no bets on this outcome.
     */
    function getOdds(uint256 poolId, uint8 outcomeIndex) external view returns (uint256) {
        Pool storage p = pools[poolId];
        require(outcomeIndex < p.outcomeLabels.length, "Invalid outcome");

        if (p.totalPool == 0) return 0;
        if (p.outcomeTotals[outcomeIndex] == 0) return type(uint256).max;

        return (p.totalPool * 10000) / p.outcomeTotals[outcomeIndex];
    }

    // --- INTERNAL FUNCTIONS ---

    function _requirePoolExists(uint256 poolId) internal view returns (Pool storage) {
        require(poolId > 0 && poolId <= poolCounter, "Pool does not exist");
        return pools[poolId];
    }

    function _findWinnerIndex(
        address[] memory players,
        address winner
    ) internal pure returns (uint8) {
        for (uint8 i = 0; i < players.length; i++) {
            if (players[i] == winner) {
                return i;
            }
        }
        return type(uint8).max;
    }

    function _resolvePoolAsDraw(uint256 poolId) internal {
        Pool storage p = pools[poolId];
        p.resolved = true;
        p.isDraw = true;
        emit PoolResolvedDraw(poolId, p.totalPool);
    }

    function _resolvePoolInternal(uint256 poolId, uint8 winningOutcome) internal {
        Pool storage p = pools[poolId];

        p.resolved = true;
        p.winningOutcome = winningOutcome;

        // Calculate rake on winning pool
        uint256 totalRake = (p.totalPool * RAKE_BPS) / 10000;

        // Transfer rake to treasury
        if (totalRake > 0) {
            usdc.safeTransfer(treasury, totalRake);
        }

        emit PoolResolved(poolId, winningOutcome, p.totalPool, totalRake);
    }

    function _processDrawRefund(uint256 poolId, Pool storage p) internal {
        uint256 totalRefund = 0;

        // Sum all bets by this bettor across all outcomes
        for (uint8 i = 0; i < p.outcomeLabels.length; i++) {
            uint256 betAmount = bets[poolId][msg.sender][i];
            if (betAmount > 0) {
                totalRefund += betAmount;
                bets[poolId][msg.sender][i] = 0;
            }
        }

        require(totalRefund > 0, "No bets to refund");

        usdc.safeTransfer(msg.sender, totalRefund);

        emit RefundClaimed(poolId, msg.sender, totalRefund);
    }

    function _processWinningPayout(uint256 poolId, Pool storage p) internal {
        uint256 betAmount = bets[poolId][msg.sender][p.winningOutcome];

        require(betAmount > 0, "No winning bets");

        // Clear the bet
        bets[poolId][msg.sender][p.winningOutcome] = 0;

        // Calculate payout: (myBet / winningTotal) * (remainingPool)
        // remainingPool = totalPool - rake (already transferred on resolution)
        uint256 winningTotal = p.outcomeTotals[p.winningOutcome];
        uint256 totalRake = (p.totalPool * RAKE_BPS) / 10000;
        uint256 remainingPool = p.totalPool - totalRake;

        uint256 payout = (betAmount * remainingPool) / winningTotal;

        usdc.safeTransfer(msg.sender, payout);

        emit WinningsClaimed(poolId, msg.sender, payout);
    }

    // --- RECEIVE / FALLBACK ---

    receive() external payable {
        revert("ETH not accepted");
    }
}
