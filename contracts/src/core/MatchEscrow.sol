// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IGameLogic.sol";
import "../interfaces/IPriceProvider.sol";

/**
 * @title MatchEscrow
 * @dev Hardened escrow for adversarial game theory matches on Base.
 * Implements Commit/Reveal scheme and secure ETH management.
 */
contract MatchEscrow is ReentrancyGuard, Ownable, Pausable {
    
    enum MatchStatus { OPEN, ACTIVE, SETTLED, VOIDED }
    enum Phase { COMMIT, REVEAL }

    struct Match {
        address  playerA;
        address  playerB;
        uint256  stake;           // per player
        address  gameLogic;       // IGameLogic implementation
        uint8    winsA;
        uint8    winsB;
        uint8    currentRound;
        uint8    drawCounter;     // Limits Sudden Death loops
        Phase    phase;
        MatchStatus status;
        uint256  commitDeadline;
        uint256  revealDeadline;
    }

    struct RoundCommit {
        bytes32  commitHash;
        uint8    move;            // 0=unset, 1=Rock, 2=Paper, 3=Scissors
        bytes32  salt;
        bool     revealed;
    }

    uint256 public matchCounter;
    uint256 public constant RAKE_BPS = 500; // 5%
    address public treasury;
    IPriceProvider public immutable priceProvider;

    mapping(uint256 => Match) public matches;
    mapping(uint256 => mapping(uint8 => mapping(address => RoundCommit))) public roundCommits;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => bool) public approvedGameLogic;

    // Timeouts
    uint256 public constant COMMIT_WINDOW = 30 minutes;
    uint256 public constant REVEAL_WINDOW = 30 minutes;
    uint8 public constant MAX_ROUNDS = 5;

    event MatchCreated(uint256 indexed matchId, address indexed creator, uint256 stake, address gameLogic);
    event MatchJoined(uint256 indexed matchId, address indexed rival);
    event MoveCommitted(uint256 indexed matchId, uint8 round, address indexed player);
    event MoveRevealed(uint256 indexed matchId, uint8 round, address indexed player, uint8 move);
    event RoundResolved(uint256 indexed matchId, uint8 round, uint8 result);
    event MatchSettled(uint256 indexed matchId, address winner, uint256 payout);
    event MatchVoided(uint256 indexed matchId, string reason);
    event WithdrawalQueued(address indexed user, uint256 amount);
    event PriceUpdated(uint256 newMinStake);

    constructor(address initialTreasury, address initialPriceProvider) Ownable(msg.sender) {
        require(initialTreasury != address(0), "Invalid treasury");
        require(initialPriceProvider != address(0), "Invalid price provider");
        treasury = initialTreasury;
        priceProvider = IPriceProvider(initialPriceProvider);
    }

    /**
     * @dev Creates a match with specific ETH stake.
     */
    function createMatch(uint256 stake, address gameLogic) external payable nonReentrant whenNotPaused {
        require(msg.value == stake, "Incorrect stake amount");
        require(approvedGameLogic[gameLogic], "Game logic not approved");

        uint256 usdValue = priceProvider.getUsdValue(stake);
        require(usdValue >= priceProvider.getMinStakeUsd(), "Stake below minimum");

        uint256 matchId = ++matchCounter;
        matches[matchId] = Match({
            playerA: msg.sender,
            playerB: address(0),
            stake: stake,
            gameLogic: gameLogic,
            winsA: 0,
            winsB: 0,
            currentRound: 1,
            drawCounter: 0,
            phase: Phase.COMMIT,
            status: MatchStatus.OPEN,
            commitDeadline: 0,
            revealDeadline: 0
        });

        emit MatchCreated(matchId, msg.sender, stake, gameLogic);
    }

    /**
     * @dev Creates a match by specifying a USD amount (18 decimals).
     * Contract converts USD to required ETH.
     */
    function createMatchUSD(uint256 usdAmount, address gameLogic) external payable nonReentrant whenNotPaused {
        require(approvedGameLogic[gameLogic], "Game logic not approved");
        
        uint256 requiredEth = priceProvider.getEthAmount(usdAmount);
        require(msg.value >= requiredEth, "Insufficient ETH for USD stake");
        require(requiredEth > 0, "Stake must be > 0");

        uint256 usdValue = priceProvider.getUsdValue(requiredEth);
        require(usdValue >= priceProvider.getMinStakeUsd(), "Stake below minimum");

        uint256 matchId = ++matchCounter;
        matches[matchId] = Match({
            playerA: msg.sender,
            playerB: address(0),
            stake: requiredEth,
            gameLogic: gameLogic,
            winsA: 0,
            winsB: 0,
            currentRound: 1,
            drawCounter: 0,
            phase: Phase.COMMIT,
            status: MatchStatus.OPEN,
            commitDeadline: 0,
            revealDeadline: 0
        });

        emit MatchCreated(matchId, msg.sender, requiredEth, gameLogic);

        // Refund excess ETH
        if (msg.value > requiredEth) {
            _safeTransfer(msg.sender, msg.value - requiredEth);
        }
    }

    /**
     * @dev Joins an open match.
     */
    function joinMatch(uint256 matchId) external payable nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.OPEN, "Match not open");
        require(msg.value == m.stake, "Incorrect stake amount");
        require(msg.sender != m.playerA, "Cannot play against yourself");

        m.playerB = msg.sender;
        m.status = MatchStatus.ACTIVE;
        m.commitDeadline = block.timestamp + COMMIT_WINDOW;

        emit MatchJoined(matchId, msg.sender);
    }

    /**
     * @dev Commits a hashed move.
     */
    function commitMove(uint256 matchId, bytes32 commitHash) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(m.phase == Phase.COMMIT, "Not in commit phase");
        require(block.timestamp <= m.commitDeadline, "Commit deadline passed");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");
        require(roundCommits[matchId][m.currentRound][msg.sender].commitHash == bytes32(0), "Already committed");

        roundCommits[matchId][m.currentRound][msg.sender].commitHash = commitHash;
        emit MoveCommitted(matchId, m.currentRound, msg.sender);

        // If both committed, move to reveal phase
        if (roundCommits[matchId][m.currentRound][m.playerA].commitHash != bytes32(0) &&
            roundCommits[matchId][m.currentRound][m.playerB].commitHash != bytes32(0)) {
            m.phase = Phase.REVEAL;
            m.revealDeadline = block.timestamp + REVEAL_WINDOW;
        }
    }

    /**
     * @dev Reveals a move with the secret salt.
     */
    function revealMove(uint256 matchId, uint8 move, bytes32 salt) external nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(m.phase == Phase.REVEAL, "Not in reveal phase");
        require(block.timestamp <= m.revealDeadline, "Reveal deadline passed");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");
        require(!roundCommits[matchId][m.currentRound][msg.sender].revealed, "Already revealed");

        // Verify Hash: keccak256("FALKEN_V1" + address(this) + matchId + round + sender + move + salt)
        bytes32 expectedHash = keccak256(abi.encodePacked("FALKEN_V1", address(this), matchId, uint256(m.currentRound), msg.sender, uint256(move), salt));
        require(expectedHash == roundCommits[matchId][m.currentRound][msg.sender].commitHash, "Invalid hash");
        
        // For FISE matches, gameLogic is address(this), so skip isValidMove check
        // FISE moves are validated by the FalkenVM during resolution
        if (m.gameLogic != address(this)) {
            require(IGameLogic(m.gameLogic).isValidMove(move), "Invalid move");
        }

        roundCommits[matchId][m.currentRound][msg.sender].move = move;
        roundCommits[matchId][m.currentRound][msg.sender].salt = salt;
        roundCommits[matchId][m.currentRound][msg.sender].revealed = true;

        emit MoveRevealed(matchId, m.currentRound, msg.sender, move);

        // If both revealed, resolve the round
        if (roundCommits[matchId][m.currentRound][m.playerA].revealed &&
            roundCommits[matchId][m.currentRound][m.playerB].revealed) {
            _resolveRound(matchId);
        }
    }

    /**
     * @dev Internal round resolution logic.
     */
    function _resolveRound(uint256 matchId) internal virtual {
        Match storage m = matches[matchId];
        uint8 moveA = roundCommits[matchId][m.currentRound][m.playerA].move;
        uint8 moveB = roundCommits[matchId][m.currentRound][m.playerB].move;

        uint8 result = IGameLogic(m.gameLogic).resolveRound(moveA, moveB);
        emit RoundResolved(matchId, m.currentRound, result);

        if (result == 1) { // Player A wins round
            m.winsA++;
            m.drawCounter = 0;
        } else if (result == 2) { // Player B wins round
            m.winsB++;
            m.drawCounter = 0;
        } else { // Draw
            m.drawCounter++;
        }

        // Cleanup round storage
        delete roundCommits[matchId][m.currentRound][m.playerA];
        delete roundCommits[matchId][m.currentRound][m.playerB];

        // Check for match winner
        uint8 winsReq = IGameLogic(m.gameLogic).winsRequired();
        if (m.winsA >= winsReq || m.winsB >= winsReq) {
            _settleMatch(matchId);
            return;
        }

        // Handle round progression
        if (result == 0) {
            // Draw - check for sudden death limit
            if (m.drawCounter >= 3) {
                // Sudden death limit reached
                if (winsReq == 1) {
                    // No one can win this match (all draws with winsRequired=1)
                    _settleMatch(matchId);
                    return;
                }
                // Check if max rounds reached
                if (m.currentRound >= MAX_ROUNDS) {
                    _settleMatch(matchId);
                    return;
                }
                // Advance to next round, reset draw counter
                m.currentRound++;
                m.drawCounter = 0;
            }
            // Else: stay in same round (sudden death continues)
        } else {
            // Non-draw result - check max rounds before advancing
            if (m.currentRound >= MAX_ROUNDS) {
                _settleMatch(matchId);
                return;
            }
            // Advance to next round
            m.currentRound++;
        }

        // Continue to next round
        m.phase = Phase.COMMIT;
        m.commitDeadline = block.timestamp + COMMIT_WINDOW;
    }

    /**
     * @dev Settles the match and pays out the winner.
     */
    function _settleMatch(uint256 matchId) internal {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");

        m.status = MatchStatus.SETTLED;
        uint256 totalPot = m.stake * 2;

        if (m.winsA == m.winsB) {
            // True Draw (refund both)
            _safeTransfer(m.playerA, m.stake);
            _safeTransfer(m.playerB, m.stake);
            emit MatchSettled(matchId, address(0), m.stake);
        } else {
            address winner = m.winsA > m.winsB ? m.playerA : m.playerB;
            uint256 rake = (totalPot * RAKE_BPS) / 10000;
            uint256 payout = totalPot - rake;

            _safeTransfer(treasury, rake);
            _safeTransfer(winner, payout);
            emit MatchSettled(matchId, winner, payout);
        }
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }

    function approveGameLogic(address logic, bool approved) external onlyOwner {
        require(logic != address(0), "Invalid logic address");
        approvedGameLogic[logic] = approved;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        
        // CEI: Update before call
        pendingWithdrawals[msg.sender] = 0;
        
        (bool success, ) = address(msg.sender).call{value: amount}("");
        require(success, "Withdraw failed");
    }

    function _safeTransfer(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        
        // Attempt direct transfer
        (bool success, ) = address(to).call{value: amount}("");
        
        if (!success) {
            // Fallback to IOU system
            pendingWithdrawals[to] += amount;
            emit WithdrawalQueued(to, amount);
        }
    }

    function adminVoidMatch(uint256 matchId) external onlyOwner {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.OPEN || m.status == MatchStatus.ACTIVE, "Match not active");
        
        m.status = MatchStatus.VOIDED;
        _safeTransfer(m.playerA, m.stake);
        if (m.playerB != address(0)) {
            _safeTransfer(m.playerB, m.stake);
        }
        emit MatchVoided(matchId, "Admin intervention");
    }

    /**
     * @dev Allows player A to cancel an open match before anyone joins.
     */
    function cancelMatch(uint256 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.OPEN, "Match not open");
        require(msg.sender == m.playerA, "Not match creator");

        m.status = MatchStatus.VOIDED;
        _safeTransfer(m.playerA, m.stake);

        emit MatchVoided(matchId, "Cancelled by creator");
    }

    /**
     * @dev Allows a player to claim a win if opponent times out.
     */
    function claimTimeout(uint256 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");

        address opponent = (msg.sender == m.playerA) ? m.playerB : m.playerA;

        if (m.phase == Phase.COMMIT) {
            require(block.timestamp > m.commitDeadline, "Deadline not passed");
            require(roundCommits[matchId][m.currentRound][msg.sender].commitHash != bytes32(0), "You did not commit");
            require(roundCommits[matchId][m.currentRound][opponent].commitHash == bytes32(0), "Opponent committed");
        } else {
            require(block.timestamp > m.revealDeadline, "Deadline not passed");
            require(roundCommits[matchId][m.currentRound][msg.sender].revealed, "You did not reveal");
            require(!roundCommits[matchId][m.currentRound][opponent].revealed, "Opponent revealed");
        }

        // Award 3 wins to claimer to trigger settlement
        if (msg.sender == m.playerA) {
            m.winsA = 3;
        } else {
            m.winsB = 3;
        }
        
        _settleMatch(matchId);
    }

    /**
     * @dev Allows voiding a match if both players fail to move (mutual timeout).
     */
    function mutualTimeout(uint256 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");

        if (m.phase == Phase.COMMIT) {
            require(block.timestamp > m.commitDeadline, "Deadline not passed");
            require(roundCommits[matchId][m.currentRound][m.playerA].commitHash == bytes32(0) &&
                    roundCommits[matchId][m.currentRound][m.playerB].commitHash == bytes32(0), "Mutual timeout not met");
        } else {
            require(block.timestamp > m.revealDeadline, "Deadline not passed");
            require(!roundCommits[matchId][m.currentRound][m.playerA].revealed &&
                    !roundCommits[matchId][m.currentRound][m.playerB].revealed, "Mutual timeout not met");
        }

        m.status = MatchStatus.VOIDED;
        
        // Apply small penalty for mutual timeout (1% total, split between treasury and both players)
        uint256 penalty = (m.stake * 2 * 100) / 10000; // 1% of total pot
        uint256 totalRefund = (m.stake * 2) - penalty;
        uint256 refundA = totalRefund / 2;
        uint256 refundB = totalRefund - refundA;

        _safeTransfer(treasury, penalty);
        _safeTransfer(m.playerA, refundA);
        _safeTransfer(m.playerB, refundB);

        emit MatchVoided(matchId, "Mutual timeout");
    }

    /**
     * @dev Returns the round commit status for a player.
     */
    function getRoundStatus(uint256 matchId, uint8 round, address player) external view returns (bytes32 commitHash, bool revealed) {
        RoundCommit storage rc = roundCommits[matchId][round][player];
        return (rc.commitHash, rc.revealed);
    }

    /**
     * @dev Returns full match data.
     */
    function getMatch(uint256 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    receive() external payable {}
}
