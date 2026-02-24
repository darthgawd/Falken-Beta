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
    uint256 public constant RAKE_BPS = 500; // 5%
    address public treasury;

    mapping(uint256 => Match) public matches;
    mapping(uint256 => mapping(uint8 => mapping(address => RoundCommit))) public roundCommits;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => bool) public approvedGameLogic;

    event MatchCreated(uint256 indexed matchId, address indexed playerA, uint256 stake, address gameLogic);
    event MatchJoined(uint256 indexed matchId, address indexed playerB);
    event RoundStarted(uint256 indexed matchId, uint8 roundNumber);
    event MoveCommitted(uint256 indexed matchId, uint8 roundNumber, address indexed player);
    event MoveRevealed(uint256 indexed matchId, uint8 roundNumber, address indexed player, uint8 move);
    event RoundResolved(uint256 indexed matchId, uint8 roundNumber, uint8 winner);
    event MatchSettled(uint256 indexed matchId, address indexed winner, uint256 payout);
    event TimeoutClaimed(uint256 indexed matchId, uint8 roundNumber, address indexed claimer);
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
        require(block.timestamp <= m.commitDeadline, "Commit deadline passed");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");

        RoundCommit storage rc = roundCommits[_matchId][m.currentRound][msg.sender];
        require(rc.commitHash == bytes32(0), "Already committed");

        rc.commitHash = _commitHash;
        emit MoveCommitted(_matchId, m.currentRound, msg.sender);

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
        require(block.timestamp <= m.revealDeadline, "Reveal deadline passed");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");

        RoundCommit storage rc = roundCommits[_matchId][m.currentRound][msg.sender];
        require(!rc.revealed, "Already revealed");

        bytes32 expectedHash = keccak256(abi.encodePacked(_matchId, m.currentRound, msg.sender, _move, _salt));
        require(rc.commitHash == expectedHash, "Invalid reveal");
        require(IGameLogic(m.gameLogic).isValidMove(_move), "Invalid move");

        rc.move = _move;
        rc.salt = _salt;
        rc.revealed = true;

        emit MoveRevealed(_matchId, m.currentRound, msg.sender, _move);

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

        if (winner == 1) m.winsA++;
        else if (winner == 2) m.winsB++;

        emit RoundResolved(_matchId, m.currentRound, winner);

        if (m.winsA == 3 || m.winsB == 3 || m.currentRound >= 5) {
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
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a participant");

        address opponent = (msg.sender == m.playerA) ? m.playerB : m.playerA;

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

        if (msg.sender == m.playerA) m.winsA = 3;
        else m.winsB = 3;
        _settleMatch(_matchId);
    }

    function mutualTimeout(uint256 _matchId) external nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");

        if (m.phase == Phase.COMMIT) {
            require(block.timestamp > m.commitDeadline, "Deadline not passed");
            require(roundCommits[_matchId][m.currentRound][m.playerA].commitHash == bytes32(0) &&
                    roundCommits[_matchId][m.currentRound][m.playerB].commitHash == bytes32(0), "Mutual timeout not met");
        } else {
            require(block.timestamp > m.revealDeadline, "Deadline not passed");
            require(!roundCommits[_matchId][m.currentRound][m.playerA].revealed &&
                    !roundCommits[_matchId][m.currentRound][m.playerB].revealed, "Mutual timeout not met");
        }

        m.status = MatchStatus.VOIDED;
        uint256 penalty = (m.stake * 2 * 100) / 10000;
        uint256 totalRefund = (m.stake * 2) - penalty;
        uint256 refundA = totalRefund / 2;
        uint256 refundB = totalRefund - refundA;

        _safeTransfer(treasury, penalty);
        _safeTransfer(m.playerA, refundA);
        _safeTransfer(m.playerB, refundB);

        emit MatchSettled(_matchId, address(0), 0);
    }

    function _settleMatch(uint256 _matchId) internal {
        Match storage m = matches[_matchId];
        m.status = MatchStatus.SETTLED;

        if (m.winsA == m.winsB) {
            _safeTransfer(m.playerA, m.stake);
            _safeTransfer(m.playerB, m.stake);
            emit MatchSettled(_matchId, address(0), m.stake);
            return;
        }

        address winner = (m.winsA > m.winsB) ? m.playerA : m.playerB;
        uint256 totalPot = m.stake * 2;
        uint256 rake = (totalPot * RAKE_BPS) / 10000;
        uint256 payout = totalPot - rake;

        _safeTransfer(treasury, rake);
        _safeTransfer(winner, payout);

        emit MatchSettled(_matchId, winner, payout);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    function approveGameLogic(address _logic, bool _approved) external onlyOwner {
        require(_logic != address(0), "Invalid logic address");
        approvedGameLogic[_logic] = _approved;
        emit GameLogicApproved(_logic, _approved);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function getMatch(uint256 _matchId) external view returns (Match memory) {
        return matches[_matchId];
    }

    function getRoundStatus(uint256 _matchId, uint8 _round, address _player) external view returns (bytes32 commitHash, bool revealed) {
        RoundCommit storage rc = roundCommits[_matchId][_round][_player];
        return (rc.commitHash, rc.revealed);
    }

    function adminVoidMatch(uint256 _matchId) external onlyOwner nonReentrant {
        Match storage m = matches[_matchId];
        require(m.status == MatchStatus.OPEN || m.status == MatchStatus.ACTIVE, "Match not voidable");
        m.status = MatchStatus.VOIDED;
        if (m.playerA != address(0)) _safeTransfer(m.playerA, m.stake);
        if (m.playerB != address(0)) _safeTransfer(m.playerB, m.stake);
        emit MatchSettled(_matchId, address(0), 0);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");
    }

    function _safeTransfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) {
            pendingWithdrawals[to] += amount;
            emit WithdrawalQueued(to, amount);
        }
    }

    receive() external payable {}
}
