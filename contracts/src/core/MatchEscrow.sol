// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IGameLogic.sol";

contract MatchEscrow is ReentrancyGuard, Ownable, Pausable {
    enum MatchStatus { OPEN, ACTIVE, SETTLED, VOIDED }
    enum Phase       { COMMIT, REVEAL }

    struct Match {
        address  playerA;
        address  playerB;
        uint256  stake;           // per player
        address  gameLogic;       // IGameLogic implementation
        uint8    winsA;
        uint8    winsB;
        uint8    currentRound;
        Phase    phase;
        MatchStatus status;
        uint256  commitDeadline;
        uint256  revealDeadline;
    }

    struct RoundCommit {
        bytes32  commitHash;
        uint8    move;            // 0=unset, 1=Rock, 2=Paper, 3=Scissors (standardized by logic)
        bytes32  salt;
        bool     revealed;
    }

    uint256 public matchCounter;
    uint256 public rakeBps = 500; // 5%
    address public treasury;

    mapping(uint256 => Match) public matches;
    // matchId => roundNumber => playerAddress => RoundCommit
    mapping(uint256 => mapping(uint8 => mapping(address => RoundCommit))) public roundCommits;
    // Pull-payment ledger: tracks ETH owed to recipients when a push transfer fails
    mapping(address => uint256) public pendingWithdrawals;
    // FIX #9: Whitelist of game logic contracts approved by the owner
    mapping(address => bool) public approvedGameLogic;

    event MatchCreated(uint256 indexed matchId, address indexed playerA, uint256 stake, address gameLogic);
    event MatchJoined(uint256 indexed matchId, address indexed playerB);
    event RoundStarted(uint256 indexed matchId, uint8 roundNumber);
    event MoveCommitted(uint256 indexed matchId, uint8 roundNumber, address indexed player);
    event MoveRevealed(uint256 indexed matchId, uint8 roundNumber, address indexed player, uint8 move);
    event RoundResolved(uint256 indexed matchId, uint8 roundNumber, uint8 winner);
    event MatchSettled(uint256 indexed matchId, address indexed winner, uint256 payout);
    event TimeoutClaimed(uint256 indexed matchId, uint8 roundNumber, address indexed claimer);
    // Emitted when a push transfer fails and the amount is queued for pull withdrawal
    event WithdrawalQueued(address indexed recipient, uint256 amount);
    event GameLogicApproved(address indexed logic, bool approved);

    uint256 public constant TIMEOUT_DURATION = 1 hours;

    constructor(address _treasury) Ownable(msg.sender) {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    function createMatch(uint256 _stake, address _gameLogic) external payable nonReentrant whenNotPaused {
        require(_stake > 0, "Stake must be non-zero");
        require(msg.value == _stake, "Incorrect stake amount");
        // FIX #9: Only allow whitelisted game logic contracts
        require(approvedGameLogic[_gameLogic], "Game logic not approved");

        uint256 matchId = ++matchCounter;

        matches[matchId] = Match({
            playerA: msg.sender,
            playerB: address(0),
            stake: _stake,
            gameLogic: _gameLogic,
            winsA: 0,
            winsB: 0,
            currentRound: 1,
            phase: Phase.COMMIT,
            status: MatchStatus.OPEN,
            commitDeadline: 0,
            revealDeadline: 0
        });

        emit MatchCreated(matchId, msg.sender, _stake, _gameLogic);
    }

    /**
     * @notice Allows playerA to cancel an unfilled match and withdraw stake.
     */
    function cancelMatch(uint256 _matchId) external nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.OPEN, "Match not open");
        require(msg.sender == m.playerA, "Not match creator");

        m.status = MatchStatus.VOIDED;
        _safeTransfer(m.playerA, m.stake);

        emit MatchSettled(_matchId, address(0), 0);
    }

    function joinMatch(uint256 _matchId) external payable nonReentrant whenNotPaused {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.OPEN, "Match not open");
        require(msg.value == m.stake, "Incorrect stake amount");
        require(msg.sender != m.playerA, "Cannot play against yourself");

        m.playerB = msg.sender;
        m.status = MatchStatus.ACTIVE;
        m.commitDeadline = block.timestamp + TIMEOUT_DURATION;

        emit MatchJoined(_matchId, msg.sender);
        emit RoundStarted(_matchId, m.currentRound);
    }

    function commitMove(uint256 _matchId, bytes32 _commitHash) external nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(m.phase == Phase.COMMIT, "Not in commit phase");
        // FIX #1: Enforce deadline so players cannot commit after expiry to front-run timeout claims
        require(block.timestamp <= m.commitDeadline, "Commit deadline passed");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");

        RoundCommit storage rc = roundCommits[_matchId][m.currentRound][msg.sender];
        require(rc.commitHash == bytes32(0), "Already committed");

        rc.commitHash = _commitHash;

        emit MoveCommitted(_matchId, m.currentRound, msg.sender);

        // If both committed, move to reveal phase
        if (roundCommits[_matchId][m.currentRound][m.playerA].commitHash != bytes32(0) &&
            roundCommits[_matchId][m.currentRound][m.playerB].commitHash != bytes32(0)) {
            m.phase = Phase.REVEAL;
            m.revealDeadline = block.timestamp + TIMEOUT_DURATION;
        }
    }

    function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt) external nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(m.phase == Phase.REVEAL, "Not in reveal phase");
        // FIX #2: Enforce deadline so players cannot reveal after expiry to front-run timeout claims
        require(block.timestamp <= m.revealDeadline, "Reveal deadline passed");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");

        RoundCommit storage rc = roundCommits[_matchId][m.currentRound][msg.sender];
        require(!rc.revealed, "Already revealed");

        bytes32 expectedHash = keccak256(abi.encodePacked(_matchId, m.currentRound, msg.sender, _move, _salt));
        require(rc.commitHash == expectedHash, "Invalid reveal");
        // FIX #8: Validate move against game logic before accepting — prevents resolveRound revert on bad moves
        require(IGameLogic(m.gameLogic).isValidMove(_move), "Invalid move");

        rc.move = _move;
        rc.salt = _salt;
        rc.revealed = true;

        emit MoveRevealed(_matchId, m.currentRound, msg.sender, _move);

        // If both revealed, resolve round
        if (roundCommits[_matchId][m.currentRound][m.playerA].revealed &&
            roundCommits[_matchId][m.currentRound][m.playerB].revealed) {
            _resolveRound(_matchId);
        }
    }

    function _resolveRound(uint256 _matchId) internal {
        Match storage m = matches[_matchId];
        IGameLogic logic = IGameLogic(m.gameLogic);

        uint8 winner = logic.resolveRound(
            roundCommits[_matchId][m.currentRound][m.playerA].move,
            roundCommits[_matchId][m.currentRound][m.playerB].move
        );

        if (winner == 1) {
            m.winsA++;
        } else if (winner == 2) {
            m.winsB++;
        }
        // winner == 0 is a draw, no wins awarded

        emit RoundResolved(_matchId, m.currentRound, winner);

        // Check for match end (Best of 3)
        if (m.winsA == 2 || m.winsB == 2 || m.currentRound >= 5) {
            _settleMatch(_matchId);
        } else {
            m.currentRound++;
            m.phase = Phase.COMMIT;
            m.commitDeadline = block.timestamp + TIMEOUT_DURATION;
            emit RoundStarted(_matchId, m.currentRound);
        }
    }

    function claimTimeout(uint256 _matchId) external nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");

        address opponent;
        if (msg.sender == m.playerA) {
            opponent = m.playerB;
        } else if (msg.sender == m.playerB) {
            opponent = m.playerA;
        } else {
            revert("Not a participant");
        }

        if (m.phase == Phase.COMMIT) {
            require(block.timestamp > m.commitDeadline, "Deadline not passed");
            require(roundCommits[_matchId][m.currentRound][msg.sender].commitHash != bytes32(0), "You did not commit");
            require(roundCommits[_matchId][m.currentRound][opponent].commitHash == bytes32(0), "Opponent committed");
        } else {
            require(block.timestamp > m.revealDeadline, "Deadline not passed");
            require(roundCommits[_matchId][m.currentRound][msg.sender].revealed, "You did not reveal");
            require(!roundCommits[_matchId][m.currentRound][opponent].revealed, "Opponent revealed");
        }

        emit TimeoutClaimed(_matchId, m.currentRound, msg.sender);

        // Timeout results in Match Forfeit; _settleMatch sets SETTLED status
        if (msg.sender == m.playerA) {
            m.winsA = 2; // Forfeit win
        } else {
            m.winsB = 2;
        }
        _settleMatch(_matchId);
    }

    /**
     * @notice Allows anyone to void a match if BOTH players miss a deadline.
     * @dev Charges a small 1% rake to discourage fee evasion.
     */
    function mutualTimeout(uint256 _matchId) external nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");

        bool bothFailedCommit = m.phase == Phase.COMMIT &&
            block.timestamp > m.commitDeadline &&
            roundCommits[_matchId][m.currentRound][m.playerA].commitHash == bytes32(0) &&
            roundCommits[_matchId][m.currentRound][m.playerB].commitHash == bytes32(0);

        bool bothFailedReveal = m.phase == Phase.REVEAL &&
            block.timestamp > m.revealDeadline &&
            !roundCommits[_matchId][m.currentRound][m.playerA].revealed &&
            !roundCommits[_matchId][m.currentRound][m.playerB].revealed;

        require(bothFailedCommit || bothFailedReveal, "Mutual timeout not met");

        m.status = MatchStatus.VOIDED;

        // 1% Liveness Penalty to treasury
        uint256 penalty = (m.stake * 2 * 100) / 10000;
        uint256 totalRefund = (m.stake * 2) - penalty;
        uint256 refundA = totalRefund / 2;
        uint256 refundB = totalRefund - refundA; // Handles odd-wei remainder

        _safeTransfer(treasury, penalty);
        _safeTransfer(m.playerA, refundA);
        _safeTransfer(m.playerB, refundB);

        emit MatchSettled(_matchId, address(0), 0);
    }

    function _settleMatch(uint256 _matchId) internal {
        Match storage m = matches[_matchId];
        m.status = MatchStatus.SETTLED;

        address winner;
        if (m.winsA > m.winsB) {
            winner = m.playerA;
        } else if (m.winsB > m.winsA) {
            winner = m.playerB;
        } else {
            // Tie - Refund both
            // FIX #4: Use _safeTransfer so a non-payable contract cannot permanently lose their stake
            _safeTransfer(m.playerA, m.stake);
            _safeTransfer(m.playerB, m.stake);
            emit MatchSettled(_matchId, address(0), m.stake);
            return;
        }

        uint256 totalPot = m.stake * 2;
        uint256 rake = (totalPot * rakeBps) / 10000;
        uint256 payout = totalPot - rake;

        // Treasury failure REVERTS (Critical for protocol health)
        (bool successRake, ) = payable(treasury).call{value: rake}("");
        require(successRake, "Treasury payment failed");

        // FIX #5: Use _safeTransfer so a non-payable winner contract cannot permanently lose their winnings
        _safeTransfer(winner, payout);

        emit MatchSettled(_matchId, winner, payout);
    }

    function setTreasury(address _treasury) external onlyOwner {
        // FIX #7: Mirror the constructor's zero-address guard so rake cannot be burned
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Add or remove a game logic contract from the approved whitelist.
     * @dev FIX #9: Prevents matches from being created with malicious or unverified game logic.
     */
    function approveGameLogic(address _logic, bool _approved) external onlyOwner {
        require(_logic != address(0), "Invalid logic address");
        approvedGameLogic[_logic] = _approved;
        emit GameLogicApproved(_logic, _approved);
    }

    /**
     * @notice Returns the full state of a match.
     */
    function getMatch(uint256 _matchId) external view returns (Match memory) {
        return matches[_matchId];
    }

    /**
     * @notice Returns the commit/reveal status for a player in a round.
     */
    function getRoundStatus(uint256 _matchId, uint8 _round, address _player) external view returns (bytes32 commitHash, bool revealed) {
        RoundCommit storage rc = roundCommits[_matchId][_round][_player];
        return (rc.commitHash, rc.revealed);
    }

    /**
     * @notice Emergency function to void a match and refund both players.
     * @param _matchId The ID of the match to void.
     */
    function adminVoidMatch(uint256 _matchId) external onlyOwner nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.OPEN || m.status == MatchStatus.ACTIVE, "Match not voidable");

        m.status = MatchStatus.VOIDED;

        // FIX #6: Use _safeTransfer so a failed refund cannot silently strand funds with no recovery path
        if (m.playerA != address(0)) {
            _safeTransfer(m.playerA, m.stake);
        }
        if (m.playerB != address(0)) {
            _safeTransfer(m.playerB, m.stake);
        }

        emit MatchSettled(_matchId, address(0), 0);
    }

    /**
     * @notice Pull-payment withdrawal for recipients whose push transfer failed.
     * @dev Funds are queued here by _safeTransfer when a push to a contract address fails.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");
    }

    /**
     * @dev Attempts to push ETH to `to`. If the push fails (e.g. recipient is a
     *      non-payable contract), the amount is recorded in pendingWithdrawals so
     *      the recipient can pull it later via withdraw(). Funds are NEVER lost.
     */
    function _safeTransfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) {
            pendingWithdrawals[to] += amount;
            emit WithdrawalQueued(to, amount);
        }
    }
}
