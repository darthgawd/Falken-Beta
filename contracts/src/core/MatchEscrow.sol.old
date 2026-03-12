// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MatchEscrow
 * @dev Universal "Banker" contract for Falken Protocol.
 * Supports N-player matches using dynamic arrays and commit-reveal logic.
 * Payments handled exclusively in USDC.
 */
abstract contract MatchEscrow is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;
    
    enum MatchStatus { OPEN, ACTIVE, SETTLED, VOIDED }
    enum Phase { COMMIT, REVEAL }

    struct Match {
        address[] players;
        uint256   stake;           // Initial amount per player (USDC)
        uint256   totalPot;        // Total pot including additional bets
        bytes32   logicId;         // FISE Logic Identifier
        uint8     maxPlayers;      // Capacity of this match
        uint8     currentRound;
        uint8[]   wins;            // Score for each player index
        uint8     drawCounter;     // Consecutive draw counter for sudden death
        uint8     winsRequired;    // Rounds needed to win (1 for single-round, 3 for best-of-5, etc.)
        Phase     phase;
        MatchStatus status;
        uint256   commitDeadline;
        uint256   revealDeadline;
        address   winner;          // Final winner address
    }

    struct RoundCommit {
        bytes32  commitHash;
        uint8    move;
        bytes32  salt;
        bool     revealed;
    }

    uint256 public matchCounter;
    uint256 public constant RAKE_BPS = 500; // 5% total rake
    address public treasury;
    IERC20 public immutable usdc;

    mapping(uint256 => Match) public matches;
    // matchId => round => player => commit
    mapping(uint256 => mapping(uint8 => mapping(address => RoundCommit))) public roundCommits;
    // matchId => round => count of reveals
    mapping(uint256 => mapping(uint8 => uint8)) public roundRevealCount;
    // matchId => round => count of commits
    mapping(uint256 => mapping(uint8 => uint8)) public roundCommitCount;
    // matchId => player => contribution
    mapping(uint256 => mapping(address => uint256)) public playerContributions;

    mapping(address => uint256) public pendingWithdrawals;

    uint256 public constant COMMIT_WINDOW = 30 minutes;
    uint256 public constant REVEAL_WINDOW = 30 minutes;
    uint8 public constant MAX_ROUNDS = 10;

    event MatchCreated(uint256 indexed matchId, address indexed creator, uint256 stake, bytes32 indexed logicId, uint8 maxPlayers, uint8 winsRequired);
    event MatchJoined(uint256 indexed matchId, address indexed player, uint8 index);
    event MoveCommitted(uint256 indexed matchId, uint8 round, address indexed player);
    event MoveRevealed(uint256 indexed matchId, uint8 round, address indexed player, uint8 move, bytes32 salt);
    event RoundResolved(uint256 indexed matchId, uint8 round, uint8 winnerIndex);
    event MatchSettled(uint256 indexed matchId, address winner, uint256 payout);
    event MatchVoided(uint256 indexed matchId, string reason);
    event WithdrawalQueued(address indexed user, uint256 amount);
    event BetPlaced(uint256 indexed matchId, address indexed player, uint256 amount, uint256 newTotalPot);

    constructor(address initialTreasury, address usdcAddress) Ownable(msg.sender) {
        require(initialTreasury != address(0), "Invalid treasury");
        require(usdcAddress != address(0), "Invalid USDC");
        treasury = initialTreasury;
        usdc = IERC20(usdcAddress);
    }

    /**
     * @dev Internal helper to check if an address is in a match.
     */
    function _isPlayer(uint256 matchId, address account) internal view returns (bool) {
        address[] memory p = matches[matchId].players;
        for (uint256 i = 0; i < p.length; i++) {
            if (p[i] == account) return true;
        }
        return false;
    }

    /**
     * @dev Joins a match.
     */
    function joinMatch(uint256 matchId) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.OPEN, "Match not open");
        require(m.players.length < m.maxPlayers, "Match full");
        require(!_isPlayer(matchId, msg.sender), "Already joined");

        usdc.safeTransferFrom(msg.sender, address(this), m.stake);
        m.players.push(msg.sender);
        m.totalPot += m.stake;
        playerContributions[matchId][msg.sender] = m.stake;

        emit MatchJoined(matchId, msg.sender, uint8(m.players.length - 1));

        if (m.players.length == m.maxPlayers) {
            m.status = MatchStatus.ACTIVE;
            m.commitDeadline = block.timestamp + COMMIT_WINDOW;
        }
    }

    /**
     * @dev Allows a player to place an additional bet (raise) during ACTIVE status.
     * @param matchId The match ID
     * @param additionalUSDC Additional amount to bet
     */
    function placeBet(uint256 matchId, uint256 additionalUSDC) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(_isPlayer(matchId, msg.sender), "Not participant");
        require(additionalUSDC > 0, "Bet must be > 0");

        usdc.safeTransferFrom(msg.sender, address(this), additionalUSDC);
        
        m.totalPot += additionalUSDC;
        playerContributions[matchId][msg.sender] += additionalUSDC;

        emit BetPlaced(matchId, msg.sender, additionalUSDC, m.totalPot);
    }

    /**
     * @dev Commits a move.
     */
    function commitMove(uint256 matchId, bytes32 commitHash) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(m.phase == Phase.COMMIT, "Wrong phase");
        require(block.timestamp <= m.commitDeadline, "Commit timeout");
        require(_isPlayer(matchId, msg.sender), "Not participant");
        require(roundCommits[matchId][m.currentRound][msg.sender].commitHash == bytes32(0), "Already committed");

        roundCommits[matchId][m.currentRound][msg.sender].commitHash = commitHash;
        roundCommitCount[matchId][m.currentRound]++;

        emit MoveCommitted(matchId, m.currentRound, msg.sender);

        if (roundCommitCount[matchId][m.currentRound] == m.maxPlayers) {
            m.phase = Phase.REVEAL;
            m.revealDeadline = block.timestamp + REVEAL_WINDOW;
        }
    }

    /**
     * @dev Reveals a move.
     */
    function revealMove(uint256 matchId, uint8 move, bytes32 salt) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(m.phase == Phase.REVEAL, "Wrong phase");
        require(block.timestamp <= m.revealDeadline, "Reveal timeout");
        require(_isPlayer(matchId, msg.sender), "Not participant");
        require(!roundCommits[matchId][m.currentRound][msg.sender].revealed, "Already revealed");

        bytes32 expectedHash = keccak256(abi.encodePacked("FALKEN_V1", address(this), matchId, uint256(m.currentRound), msg.sender, uint256(move), salt));
        require(expectedHash == roundCommits[matchId][m.currentRound][msg.sender].commitHash, "Invalid hash");
        
        roundCommits[matchId][m.currentRound][msg.sender].move = move;
        roundCommits[matchId][m.currentRound][msg.sender].salt = salt;
        roundCommits[matchId][m.currentRound][msg.sender].revealed = true;
        roundRevealCount[matchId][m.currentRound]++;

        emit MoveRevealed(matchId, m.currentRound, msg.sender, move, salt);

        if (roundRevealCount[matchId][m.currentRound] == m.maxPlayers) {
            _resolveRound(matchId);
        }
    }

    function _resolveRound(uint256 matchId) internal virtual;

    /**
     * @dev Allows a player to claim win if opponent times out.
     * Can be called during COMMIT phase (opponent didn't commit) or REVEAL phase (opponent didn't reveal).
     */
    function claimTimeout(uint256 matchId) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(_isPlayer(matchId, msg.sender), "Not participant");
        
        bool isCommitTimeout = (m.phase == Phase.COMMIT && block.timestamp > m.commitDeadline);
        bool isRevealTimeout = (m.phase == Phase.REVEAL && block.timestamp > m.revealDeadline);
        require(isCommitTimeout || isRevealTimeout, "Not timed out");
        
        // Check if caller has committed (for commit phase) or revealed (for reveal phase)
        bool callerActed = false;
        bool opponentActed = false;
        
        for (uint256 i = 0; i < m.players.length; i++) {
            address player = m.players[i];
            if (player == msg.sender) {
                if (m.phase == Phase.COMMIT) {
                    callerActed = roundCommits[matchId][m.currentRound][player].commitHash != bytes32(0);
                } else {
                    callerActed = roundCommits[matchId][m.currentRound][player].revealed;
                }
            } else {
                if (m.phase == Phase.COMMIT) {
                    if (roundCommits[matchId][m.currentRound][player].commitHash != bytes32(0)) {
                        opponentActed = true;
                    }
                } else {
                    if (roundCommits[matchId][m.currentRound][player].revealed) {
                        opponentActed = true;
                    }
                }
            }
        }
        
        // Caller must have acted, opponent must have NOT acted
        require(callerActed, "You must act first");
        require(!opponentActed, "Opponent acted");
        
        // Settle with caller as winner (find their index)
        uint8 winnerIndex = 255;
        for (uint8 i = 0; i < m.players.length; i++) {
            if (m.players[i] == msg.sender) {
                winnerIndex = i;
                break;
            }
        }
        
        emit MatchVoided(matchId, "Timeout claimed");
        _settleMatch(matchId, winnerIndex);
    }

    /**
     * @dev Allows mutual timeout - both players get refund minus penalty.
     * Can be called after timeout if NEITHER player acted.
     */
    function mutualTimeout(uint256 matchId) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(_isPlayer(matchId, msg.sender), "Not participant");
        
        bool isCommitTimeout = (m.phase == Phase.COMMIT && block.timestamp > m.commitDeadline);
        bool isRevealTimeout = (m.phase == Phase.REVEAL && block.timestamp > m.revealDeadline);
        require(isCommitTimeout || isRevealTimeout, "Not timed out");
        
        // Check that NO player has committed (for commit phase) or revealed (for reveal phase)
        for (uint256 i = 0; i < m.players.length; i++) {
            address player = m.players[i];
            if (m.phase == Phase.COMMIT) {
                require(roundCommits[matchId][m.currentRound][player].commitHash == bytes32(0), "Someone committed");
            } else {
                require(!roundCommits[matchId][m.currentRound][player].revealed, "Someone revealed");
            }
        }
        
        // Refund with 1% penalty each (99% back)
        m.status = MatchStatus.VOIDED;
        uint256 refund = (m.stake * 99) / 100;
        uint256 penalty = m.stake - refund;
        
        for (uint256 i = 0; i < m.players.length; i++) {
            _safeTransferUSDC(m.players[i], refund);
        }
        
        // Penalty goes to treasury
        _safeTransferUSDC(treasury, penalty * m.players.length);
        
        emit MatchVoided(matchId, "Mutual timeout");
    }

    /**
     * @dev Payout logic for N-players. 
     * @param matchId ID of match
     * @param winnerIndex The index in the players array who won. 
     * Use 255 for Draw (splits pot).
     */
    function _settleMatch(uint256 matchId, uint8 winnerIndex) internal {
        Match storage m = matches[matchId];
        m.status = MatchStatus.SETTLED;
        m.phase = Phase.REVEAL; // Mark as finished
        uint256 totalPot = m.totalPot;
        uint256 rake = (totalPot * RAKE_BPS) / 10000;
        uint256 payout = totalPot - rake;

        _safeTransferUSDC(treasury, rake);

        if (winnerIndex == 255) {
            // Draw: Split remaining pot among all players
            uint256 split = payout / m.players.length;
            for (uint256 i = 0; i < m.players.length; i++) {
                _safeTransferUSDC(m.players[i], split);
            }
            m.winner = address(0);
            emit MatchSettled(matchId, address(0), split);
        } else {
            address winnerAddr = m.players[winnerIndex];
            m.winner = winnerAddr;
            _safeTransferUSDC(winnerAddr, payout);
            emit MatchSettled(matchId, winnerAddr, payout);
        }
    }

    function _safeTransferUSDC(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        try usdc.transfer(to, amount) returns (bool success) {
            if (!success) {
                pendingWithdrawals[to] += amount;
                emit WithdrawalQueued(to, amount);
            }
        } catch {
            pendingWithdrawals[to] += amount;
            emit WithdrawalQueued(to, amount);
        }
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No balance");
        pendingWithdrawals[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid address");
        treasury = newTreasury;
    }

    /**
     * @dev Allows owner to set wins required for a match (for single-round or custom formats).
     */
    function setWinsRequired(uint256 matchId, uint8 winsRequired) external onlyOwner {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.OPEN || m.status == MatchStatus.ACTIVE, "Match not active");
        require(winsRequired > 0, "Wins required must be > 0");
        m.winsRequired = winsRequired;
    }

    /**
     * @dev Allows owner to void any match and refund stakes.
     */
    function adminVoidMatch(uint256 matchId) external onlyOwner {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.OPEN || m.status == MatchStatus.ACTIVE, "Cannot void");
        
        m.status = MatchStatus.VOIDED;
        m.phase = Phase.REVEAL; // Mark as finished
        for (uint256 i = 0; i < m.players.length; i++) {
            _safeTransferUSDC(m.players[i], m.stake);
        }
        emit MatchVoided(matchId, "Admin intervention");
    }

    function getMatch(uint256 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    /**
     * @dev Returns the commit hash and revealed status for a player in a round.
     */
    function getRoundStatus(uint256 matchId, uint8 round, address player) external view returns (bytes32 commitHash, bytes32 salt, bool revealed) {
        RoundCommit storage rc = roundCommits[matchId][round][player];
        return (rc.commitHash, rc.salt, rc.revealed);
    }

    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }

    event ETHReceived(address indexed sender, uint256 amount);

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        payable(owner()).transfer(balance);
    }
}
