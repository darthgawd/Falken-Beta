// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IBaseEscrow.sol";

/**
 * @title BaseEscrow
 * @dev Abstract base contract for all Falken game escrows.
 * Handles all money logic: USDC transfers, settlement, rake, withdrawals.
 * Specialized contracts inherit this and add game-specific state machines.
 *
 * SECURITY NOTES:
 * - Child contracts override _claimTimeout and _mutualTimeout (internal virtual).
 *   The external wrappers enforce nonReentrant + whenNotPaused permanently.
 * - Child contracts call _initMatch() to create matches. This centralizes all
 *   common initialization (createdAt, matchCounter, stake validation, wins array,
 *   creator auto-join) so children cannot forget critical setup.
 * - MatchStatus.OPEN is enum 0 (default). All functions that check status == OPEN
 *   also verify the match actually exists via _requireMatchExists().
 */
abstract contract BaseEscrow is IBaseEscrow, ReentrancyGuard, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    // --- CONSTANTS ---
    uint256 public constant RAKE_BPS = 750;         // 7.5% total rake (5% protocol + 2.5% developer)
    uint256 public constant DEV_ROYALTY_BPS = 250;  // 2.5% of pot to game developer
    uint256 public constant MUTUAL_TIMEOUT_PENALTY_BPS = 100; // 1% penalty
    uint256 public constant JOIN_WINDOW = 1 hours; // Time to join after creation
    uint256 public constant MIN_STAKE = 100_000; // 0.10 USDC (6 decimals)

    // --- STATE VARIABLES ---
    IERC20 public immutable usdc;
    address public treasury;
    uint256 public matchCounter;

    // Match storage
    mapping(uint256 => BaseMatch) public matches;

    // Player contributions per match (tracks stake + raises for accurate refunds)
    mapping(uint256 => mapping(address => uint256)) public playerContributions;

    // Pull-payment withdrawals
    mapping(address => uint256) public pendingWithdrawals;

    // --- CONSTRUCTOR ---
    constructor(address initialTreasury, address usdcAddress) Ownable(msg.sender) {
        require(initialTreasury != address(0), "Invalid treasury");
        require(usdcAddress != address(0), "Invalid USDC");
        treasury = initialTreasury;
        usdc = IERC20(usdcAddress);
    }

    // --- ABSTRACT FUNCTIONS (must be implemented by child contracts) ---

    /**
     * @dev Internal timeout logic. Child contracts implement phase-specific checks.
     * Called from the nonReentrant external wrapper — do NOT add nonReentrant here.
     */
    function _claimTimeout(uint256 matchId) internal virtual;

    /**
     * @dev Internal mutual timeout logic. Child contracts implement phase-specific checks.
     * Called from the nonReentrant external wrapper — do NOT add nonReentrant here.
     */
    function _mutualTimeout(uint256 matchId) internal virtual;

    /**
     * @dev Returns the developer address for a given logicId.
     * Override in child contracts to look up from LogicRegistry.
     * Returns address(0) if no registry is configured — dev royalty falls back to treasury.
     */
    function _getLogicDeveloper(bytes32 /*logicId*/) internal virtual returns (address) {
        return address(0);
    }

    /**
     * @dev Records volume for a settled match in the LogicRegistry.
     * Override in child contracts that have a registry reference.
     * No-op by default — missing registry never reverts settlement.
     */
    function _recordVolume(bytes32 /*logicId*/, uint256 /*amount*/) internal virtual {}

    // --- MATCH INITIALIZATION ---

    /**
     * @dev Centralized match initialization. Child contracts call this from their
     * createMatch() function. Handles all common setup so children can't forget
     * critical fields (createdAt, wins array, stake validation, creator auto-join).
     *
     * @return matchId The new match ID
     */
    function _initMatch(
        uint256 stake,
        bytes32 logicId,
        uint8 maxPlayers,
        uint8 winsRequired,
        uint8 maxRounds
    ) internal returns (uint256 matchId) {
        require(stake >= MIN_STAKE, "Stake below minimum");
        require(maxPlayers >= 2 && maxPlayers <= 6, "Players must be 2-6");
        require(winsRequired > 0, "Wins required must be > 0");
        require(maxRounds >= winsRequired, "Max rounds must be >= wins required");

        matchId = ++matchCounter;

        BaseMatch storage m = matches[matchId];
        m.stake = stake;
        m.logicId = logicId;
        m.maxPlayers = maxPlayers;
        m.winsRequired = winsRequired;
        m.maxRounds = maxRounds;
        m.status = MatchStatus.OPEN;
        m.createdAt = block.timestamp;
        m.currentRound = 1;

        // Initialize wins array for all player slots
        m.wins = new uint8[](maxPlayers);

        // Auto-join the creator as player[0]
        usdc.safeTransferFrom(msg.sender, address(this), stake);
        m.players.push(msg.sender);
        playerContributions[matchId][msg.sender] = stake;
        m.totalPot = stake;

        emit MatchCreated(matchId, msg.sender, stake, logicId, maxPlayers, maxRounds);
        emit PlayerJoined(matchId, msg.sender, 0);

        // If single-opponent match, stay OPEN. If maxPlayers == 1 (impossible due to require), skip.
        // Match becomes ACTIVE when full (handled in joinMatch).
    }

    // --- SHARED FUNCTIONS ---

    /**
     * @dev Join an existing match that's in OPEN status.
     * Pulls USDC stake from caller. Enforces JOIN_WINDOW expiration.
     */
    function joinMatch(uint256 matchId) external virtual nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.OPEN, "Match not open");
        require(block.timestamp <= m.createdAt + JOIN_WINDOW, "Match expired");
        require(m.players.length < m.maxPlayers, "Match full");
        require(!_isPlayer(matchId, msg.sender), "Already joined");

        // Pull USDC stake
        usdc.safeTransferFrom(msg.sender, address(this), m.stake);

        // Add player
        uint8 playerIndex = uint8(m.players.length);
        m.players.push(msg.sender);
        playerContributions[matchId][msg.sender] = m.stake;
        m.totalPot += m.stake;

        emit PlayerJoined(matchId, msg.sender, playerIndex);

        // Check if match is now full
        if (m.players.length == m.maxPlayers) {
            m.status = MatchStatus.ACTIVE;
            emit MatchActivated(matchId);
            _onMatchActivated(matchId);
        }
    }

    /**
     * @dev Leave a match that hasn't started yet (status = OPEN).
     * Refunds the stake. Intentionally NOT gated by whenNotPaused so
     * players can exit during emergencies.
     */
    function leaveMatch(uint256 matchId) external nonReentrant {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.OPEN, "Match not open");
        require(_isPlayer(matchId, msg.sender), "Not a player");

        // Find and remove player
        uint256 playerIndex = _findPlayerIndex(matchId, msg.sender);
        require(playerIndex < m.players.length, "Player not found");

        // Refund stake (CEI: zero out before transfer)
        uint256 refund = playerContributions[matchId][msg.sender];
        playerContributions[matchId][msg.sender] = 0;
        m.totalPot -= refund;

        // Remove from players array (swap with last and pop)
        if (playerIndex < m.players.length - 1) {
            m.players[playerIndex] = m.players[m.players.length - 1];
        }
        m.players.pop();

        _safeTransferUSDC(msg.sender, refund);

        emit PlayerLeft(matchId, msg.sender);

        // If no players left, void the match
        if (m.players.length == 0) {
            m.status = MatchStatus.VOIDED;
            emit MatchVoided(matchId, "All players left");
        }
    }

    /**
     * @dev Claim refund on an expired OPEN match that never filled.
     * Anyone can call this after JOIN_WINDOW expires.
     */
    function claimExpiredMatch(uint256 matchId) external nonReentrant {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.OPEN, "Match not open");
        require(block.timestamp > m.createdAt + JOIN_WINDOW, "Not expired");

        m.status = MatchStatus.VOIDED;

        // Refund all players
        for (uint i = 0; i < m.players.length; i++) {
            address player = m.players[i];
            uint256 refund = playerContributions[matchId][player];
            if (refund > 0) {
                playerContributions[matchId][player] = 0;
                _safeTransferUSDC(player, refund);
            }
        }

        emit MatchVoided(matchId, "Match expired");
    }

    /**
     * @dev Claim win if opponent times out.
     * nonReentrant + whenNotPaused enforced here — child overrides _claimTimeout only.
     */
    function claimTimeout(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(_isPlayer(matchId, msg.sender), "Not a player");

        _claimTimeout(matchId);
    }

    /**
     * @dev Mutual timeout - both players get refund minus penalty.
     * nonReentrant + whenNotPaused enforced here — child overrides _mutualTimeout only.
     */
    function mutualTimeout(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(_isPlayer(matchId, msg.sender), "Not a player");

        _mutualTimeout(matchId);
    }

    // --- PAUSE CONTROLS ---

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- SETTLEMENT ---

    /**
     * @dev Settle a match with the given resolution.
     * Supports single winner and split pots.
     * All distributions come from totalPot. Rounding dust goes to last winner.
     */
    function _settleMatch(uint256 matchId, Resolution memory res) internal {
        BaseMatch storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");

        m.status = MatchStatus.SETTLED;

        // Calculate rake split: 2.5% to developer, 5% to protocol treasury
        uint256 totalRake = (m.totalPot * RAKE_BPS) / 10000;
        uint256 devRoyalty = (m.totalPot * DEV_ROYALTY_BPS) / 10000;
        uint256 protocolRake = totalRake - devRoyalty;
        uint256 remainingPot = m.totalPot - totalRake;

        address dev = _getLogicDeveloper(m.logicId);
        if (dev != address(0)) {
            _safeTransferUSDC(dev, devRoyalty);
        } else {
            protocolRake += devRoyalty; // no developer registered, all to treasury
        }
        _safeTransferUSDC(treasury, protocolRake);

        // Distribute to winners
        require(res.winnerIndices.length > 0, "No winners");
        require(res.winnerIndices.length == res.splitBps.length, "Winner/split length mismatch");

        uint256 totalSplit = 0;
        for (uint i = 0; i < res.splitBps.length; i++) {
            totalSplit += res.splitBps[i];
        }
        require(totalSplit == 10000, "Splits must sum to 10000");

        // Distribute with rounding dust going to last winner
        uint256 distributed = 0;
        for (uint i = 0; i < res.winnerIndices.length; i++) {
            uint8 winnerIdx = res.winnerIndices[i];
            require(winnerIdx < m.players.length, "Invalid winner index");

            uint256 share;
            if (i == res.winnerIndices.length - 1) {
                share = remainingPot - distributed; // last winner gets remainder (no dust left)
            } else {
                share = (remainingPot * res.splitBps[i]) / 10000;
            }
            distributed += share;

            address winner = m.players[winnerIdx];
            _safeTransferUSDC(winner, share);

            if (i == 0) {
                m.winner = winner; // Primary winner for external reference (PredictionPool)
            }
        }

        emit MatchSettled(matchId, res.winnerIndices, remainingPot, totalRake);
        _recordVolume(m.logicId, m.totalPot);
    }

    /**
     * @dev Convenience wrapper for single-winner settlement.
     */
    function _settleMatchSingleWinner(uint256 matchId, uint8 winnerIndex) internal {
        uint8[] memory winners = new uint8[](1);
        winners[0] = winnerIndex;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        Resolution memory res = Resolution({
            winnerIndices: winners,
            splitBps: splits
        });

        _settleMatch(matchId, res);
    }

    /**
     * @dev Draw settlement — refund all players minus rake.
     */
    function _settleMatchDraw(uint256 matchId) internal {
        BaseMatch storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");

        m.status = MatchStatus.SETTLED;

        uint256 totalRake = (m.totalPot * RAKE_BPS) / 10000;
        uint256 devRoyalty = (m.totalPot * DEV_ROYALTY_BPS) / 10000;
        uint256 protocolRake = totalRake - devRoyalty;

        address dev = _getLogicDeveloper(m.logicId);
        if (dev != address(0)) {
            _safeTransferUSDC(dev, devRoyalty);
        } else {
            protocolRake += devRoyalty;
        }
        _safeTransferUSDC(treasury, protocolRake);

        // Split remaining equally among all players
        uint256 remainingPot = m.totalPot - totalRake;
        uint256 perPlayer = remainingPot / m.players.length;
        uint256 distributed = 0;

        for (uint i = 0; i < m.players.length; i++) {
            uint256 share;
            if (i == m.players.length - 1) {
                share = remainingPot - distributed;
            } else {
                share = perPlayer;
            }
            distributed += share;
            _safeTransferUSDC(m.players[i], share);
        }

        emit MatchSettled(matchId, new uint8[](0), remainingPot, totalRake);
        _recordVolume(m.logicId, m.totalPot);
    }

    /**
     * @dev Track additional contributions from raises/calls.
     * Child contracts (PokerEngine) MUST call this when pulling extra USDC.
     */
    function _addContribution(uint256 matchId, address player, uint256 amount) internal {
        playerContributions[matchId][player] += amount;
        matches[matchId].totalPot += amount;
    }

    // --- TRANSFERS ---

    /**
     * @dev Safe USDC transfer with pull-payment fallback.
     * Uses SafeERC20 consistently. If safeTransfer reverts (blocklisted address,
     * contract rejection, etc.), falls back to pull-payment queue.
     */
    function _safeTransferUSDC(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;

        // solhint-disable-next-line no-empty-blocks
        try this.executeTransfer(to, amount) {
            // success
        } catch {
            pendingWithdrawals[to] += amount;
            emit WithdrawalQueued(to, amount);
        }
    }

    /**
     * @dev External wrapper for try/catch on SafeERC20 transfer.
     * Can ONLY be called by this contract itself.
     */
    function executeTransfer(address to, uint256 amount) external {
        require(msg.sender == address(this), "Internal only");
        usdc.safeTransfer(to, amount);
    }

    /**
     * @dev Claim pending withdrawal.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");

        pendingWithdrawals[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit WithdrawalClaimed(msg.sender, amount);
    }

    // --- ADMIN ---

    /**
     * @dev Emergency void by owner. Refunds all playerContributions
     * (including raises/calls tracked via _addContribution).
     */
    function adminVoidMatch(uint256 matchId) external onlyOwner nonReentrant {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        require(
            m.status == MatchStatus.OPEN || m.status == MatchStatus.ACTIVE,
            "Cannot void"
        );

        m.status = MatchStatus.VOIDED;

        // Refund all players their full contributions (stake + raises)
        for (uint i = 0; i < m.players.length; i++) {
            address player = m.players[i];
            uint256 refund = playerContributions[matchId][player];
            if (refund > 0) {
                playerContributions[matchId][player] = 0;
                _safeTransferUSDC(player, refund);
            }
        }

        emit MatchVoided(matchId, "Admin intervention");
    }

    /**
     * @dev Set new treasury address.
     */
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    // --- VIEW FUNCTIONS ---

    function getMatch(uint256 matchId) external view returns (BaseMatch memory) {
        return matches[matchId];
    }

    function getMatchWinner(uint256 matchId) external view returns (address) {
        return matches[matchId].winner;
    }

    // --- HOOKS ---

    /**
     * @dev Called when a match becomes ACTIVE (all players joined).
     * Child contracts override to initialize game-specific state (deadlines, etc.).
     * Called inside joinMatch which already has nonReentrant.
     */
    function _onMatchActivated(uint256 matchId) internal virtual {}

    // --- INTERNAL HELPERS ---

    function _requireMatchExists(uint256 matchId) internal view {
        require(matchId > 0 && matchId <= matchCounter, "Match does not exist");
    }

    function _isPlayer(uint256 matchId, address account) internal view returns (bool) {
        BaseMatch storage m = matches[matchId];
        for (uint i = 0; i < m.players.length; i++) {
            if (m.players[i] == account) return true;
        }
        return false;
    }

    function _findPlayerIndex(uint256 matchId, address account) internal view returns (uint256) {
        BaseMatch storage m = matches[matchId];
        for (uint i = 0; i < m.players.length; i++) {
            if (m.players[i] == account) return i;
        }
        return type(uint256).max; // Not found
    }

    // --- RECEIVE / FALLBACK ---

    receive() external payable {
        revert("ETH not accepted");
    }
}
