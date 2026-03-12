// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./BaseEscrow.sol";
import "./LogicRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PokerEngine
 * @dev Extension of BaseEscrow for multi-street poker with betting.
 * Supports: 5-Card Draw (1 street), Hold'em/Omaha (4 streets), 7-Card Stud (5 streets)
 */
contract PokerEngine is BaseEscrow {
    using SafeERC20 for IERC20;

    // --- CONSTANTS ---
    uint8 public constant MAX_RAISES = 2;  // raise + re-raise, then must call/fold
    uint256 public constant BET_WINDOW = 30 minutes;
    uint256 public constant COMMIT_WINDOW = 30 minutes;
    uint256 public constant REVEAL_WINDOW = 30 minutes;

    // Betting sequence per street:
    //   Check/Check → next phase
    //   Raise → opponent must Call/Fold/Re-raise
    //   Raise → Re-raise → original raiser must Call/Fold (no more raises)
    //   raiseCount tracks this: 1 after raise, 2 after re-raise, then raise() reverts

    // --- ENUMS ---
    enum Phase { COMMIT, BET, REVEAL }
    enum BetStructure { NO_LIMIT, POT_LIMIT, FIXED_LIMIT }

    // --- STATE STRUCTS ---
    struct PokerState {
        Phase phase;
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 betDeadline;
        uint256 currentBet;          // Amount needed to call
        uint8 currentTurnIndex;      // Whose turn to act
        uint8 raiseCount;            // Raises this street (0-2)
        uint8 activePlayers;         // Players who haven't folded
        uint8 street;                // Current street (0 to maxStreets-1)
        uint8 maxStreets;            // From logic registry (1-5)
        BetStructure betStructure;   // NO_LIMIT/POT_LIMIT/FIXED_LIMIT
        bool[] folded;               // Per player fold status
        uint256[] playerBets;        // Per player bet this street
        uint256[] playerBankroll;    // Remaining buy-in per player
    }

    struct RoundCommit {
        bytes32 commitHash;
        bytes32 move;        // bytes32 for complex poker actions
        bytes32 salt;
        bool revealed;
    }

    // --- STATE VARIABLES ---
    LogicRegistry public immutable LOGIC_REGISTRY;
    address public referee;

    mapping(uint256 => PokerState) public pokerState;
    mapping(uint256 => mapping(uint8 => mapping(address => RoundCommit))) public roundCommits;
    mapping(uint256 => mapping(uint8 => uint8)) public roundCommitCount;
    mapping(uint256 => mapping(uint8 => uint8)) public roundRevealCount;

    // --- EVENTS ---
    event RefereeChanged(address indexed oldReferee, address indexed newReferee);
    event StreetAdvanced(uint256 indexed matchId, uint8 newStreet, Phase newPhase);
    event BetPlaced(uint256 indexed matchId, address indexed player, uint256 amount, uint8 action);
    event PlayerFolded(uint256 indexed matchId, address indexed player, uint8 playerIndex);
    event PotUpdated(uint256 indexed matchId, uint256 totalPot, uint256 streetPot);
    event MoveCommitted(uint256 indexed matchId, uint8 round, address indexed player);
    event MoveRevealed(uint256 indexed matchId, uint8 round, address indexed player, bytes32 move);
    event SidePotCreated(uint256 indexed matchId, uint256 potIndex, uint256 amount, uint8[] eligiblePlayers);
    event RoundResolved(uint256 indexed matchId, uint8 round, uint8 winnerIndex);

    // --- MODIFIERS ---
    modifier onlyReferee() {
        require(msg.sender == referee, "Only Referee");
        _;
    }

    // Override joinMatch to update activePlayers
    function joinMatch(uint256 matchId) external override nonReentrant whenNotPaused {
        BaseMatch storage m = matches[matchId];
        require(m.status == MatchStatus.OPEN, "Match not open");
        require(m.players.length < m.maxPlayers, "Match full");
        require(!_isPlayer(matchId, msg.sender), "Already joined");

        usdc.safeTransferFrom(msg.sender, address(this), m.stake);

        uint8 playerIndex = uint8(m.players.length);
        m.players.push(msg.sender);
        playerContributions[matchId][msg.sender] = m.stake;
        m.totalPot += m.stake;

        emit PlayerJoined(matchId, msg.sender, playerIndex);

        if (m.players.length == m.maxPlayers) {
            m.status = MatchStatus.ACTIVE;
        }

        // Update poker state
        PokerState storage ps = pokerState[matchId];
        ps.activePlayers++;
    }

    // --- CONSTRUCTOR ---
    constructor(
        address initialTreasury,
        address usdcAddress,
        address initialLogicRegistry,
        address initialReferee
    ) BaseEscrow(initialTreasury, usdcAddress) {
        require(initialLogicRegistry != address(0), "Invalid registry");
        require(initialReferee != address(0), "Invalid referee");
        LOGIC_REGISTRY = LogicRegistry(initialLogicRegistry);
        referee = initialReferee;
    }



    // --- MATCH CREATION ---

    /**
     * @dev Create a poker match with betting configuration.
     */
    function createMatch(
        uint256 stake,
        bytes32 logicId,
        uint8 maxPlayers,
        uint8 winsRequired,
        uint8 maxRounds,
        uint256 maxBuyIn,
        BetStructure betStructure
    ) external nonReentrant whenNotPaused {
        // Validate logic exists and get config
        LogicRegistry.GameLogic memory logic = LOGIC_REGISTRY.getGameLogic(logicId);
        require(bytes(logic.ipfsCid).length > 0, "Logic not found");
        require(logic.bettingEnabled, "Game does not support betting");

        // Pull stake from creator
        usdc.safeTransferFrom(msg.sender, address(this), stake);

        // Create base match
        uint256 matchId = ++matchCounter;
        BaseMatch storage m = matches[matchId];
        
        m.players.push(msg.sender);
        m.stake = stake;
        m.logicId = logicId;
        m.maxPlayers = maxPlayers;
        m.winsRequired = winsRequired;
        m.maxRounds = maxRounds;
        m.currentRound = 1;
        m.status = MatchStatus.OPEN;

        // Initialize wins array
        for (uint i = 0; i < maxPlayers; i++) {
            m.wins.push(0);
        }

        playerContributions[matchId][msg.sender] = stake;
        m.totalPot = stake;

        // Initialize poker state
        PokerState storage ps = pokerState[matchId];
        ps.phase = Phase.COMMIT;
        ps.commitDeadline = block.timestamp + COMMIT_WINDOW;
        ps.maxStreets = logic.maxStreets;
        ps.betStructure = betStructure;
        ps.activePlayers = 1;
        
        // Initialize arrays
        ps.folded = new bool[](maxPlayers);
        ps.playerBets = new uint256[](maxPlayers);
        ps.playerBankroll = new uint256[](maxPlayers);

        // Set bankroll (maxBuyIn minus entry stake)
        for (uint i = 0; i < maxPlayers; i++) {
            ps.playerBankroll[i] = maxBuyIn - stake;
        }

        emit MatchCreated(matchId, msg.sender, stake, logicId, maxPlayers, maxRounds);
    }

    // --- COMMIT PHASE ---

    function commitMove(uint256 matchId, bytes32 commitHash) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.COMMIT, "Not commit phase");
        require(block.timestamp <= ps.commitDeadline, "Commit timeout");
        require(_isPlayer(matchId, msg.sender), "Not player");

        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(roundCommits[matchId][m.currentRound][msg.sender].commitHash == bytes32(0), "Already committed");

        roundCommits[matchId][m.currentRound][msg.sender] = RoundCommit({
            commitHash: commitHash,
            move: bytes32(0),
            salt: bytes32(0),
            revealed: false
        });

        roundCommitCount[matchId][m.currentRound]++;

        emit MoveCommitted(matchId, m.currentRound, msg.sender);

        // If all committed, move to BET phase
        if (roundCommitCount[matchId][m.currentRound] == ps.activePlayers) {
            ps.phase = Phase.BET;
            ps.betDeadline = block.timestamp + BET_WINDOW;
            ps.currentTurnIndex = 0; // Start with first active player
            _advanceToNextActivePlayer(matchId); // Skip folded players
        }
    }

    // --- BET PHASE ---

    function raise(uint256 matchId, uint256 amount) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");
        require(block.timestamp <= ps.betDeadline, "Bet timeout");
        require(ps.raiseCount < MAX_RAISES, "Max raises");

        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(playerIdx == ps.currentTurnIndex, "Not your turn");
        require(!ps.folded[playerIdx], "Already folded");

        // Enforce bet structure
        if (ps.betStructure == BetStructure.FIXED_LIMIT) {
            require(amount == m.stake, "Fixed: raise must equal stake");
        } else if (ps.betStructure == BetStructure.POT_LIMIT) {
            uint256 potLimit = m.totalPot + ps.currentBet;
            require(amount <= potLimit, "Pot limit exceeded");
        }
        // NO_LIMIT: any amount up to remaining bankroll

        uint256 totalNeeded = ps.currentBet + amount;
        require(totalNeeded <= ps.playerBankroll[playerIdx], "Insufficient bankroll");

        // Pull USDC
        usdc.safeTransferFrom(msg.sender, address(this), totalNeeded);

        // Update state
        ps.playerBankroll[playerIdx] -= totalNeeded;
        ps.playerBets[playerIdx] += totalNeeded;
        m.totalPot += totalNeeded;
        ps.currentBet = amount;
        ps.raiseCount++;

        emit BetPlaced(matchId, msg.sender, totalNeeded, 2); // 2 = raise
        emit PotUpdated(matchId, m.totalPot, _calculateStreetPot(matchId));

        // Advance turn
        _advanceTurn(matchId);
    }

    function call(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");
        require(block.timestamp <= ps.betDeadline, "Bet timeout");

        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(playerIdx == ps.currentTurnIndex, "Not your turn");
        require(!ps.folded[playerIdx], "Already folded");
        require(ps.currentBet > 0, "Nothing to call");

        require(ps.currentBet <= ps.playerBankroll[playerIdx], "Insufficient bankroll");

        usdc.safeTransferFrom(msg.sender, address(this), ps.currentBet);

        ps.playerBankroll[playerIdx] -= ps.currentBet;
        ps.playerBets[playerIdx] += ps.currentBet;
        m.totalPot += ps.currentBet;

        emit BetPlaced(matchId, msg.sender, ps.currentBet, 1); // 1 = call
        emit PotUpdated(matchId, m.totalPot, _calculateStreetPot(matchId));

        // Check if betting round is complete
        if (_isBettingComplete(matchId)) {
            ps.phase = Phase.REVEAL;
            ps.revealDeadline = block.timestamp + REVEAL_WINDOW;
        } else {
            _advanceTurn(matchId);
        }
    }

    function check(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");
        require(block.timestamp <= ps.betDeadline, "Bet timeout");

        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(playerIdx == ps.currentTurnIndex, "Not your turn");
        require(!ps.folded[playerIdx], "Already folded");
        require(ps.currentBet == 0, "Must call or raise");

        emit BetPlaced(matchId, msg.sender, 0, 0); // 0 = check

        if (_isBettingComplete(matchId)) {
            ps.phase = Phase.REVEAL;
            ps.revealDeadline = block.timestamp + REVEAL_WINDOW;
        } else {
            _advanceTurn(matchId);
        }
    }

    function fold(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");

        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(playerIdx == ps.currentTurnIndex, "Not your turn");
        require(!ps.folded[playerIdx], "Already folded");

        ps.folded[playerIdx] = true;
        ps.activePlayers--;

        emit PlayerFolded(matchId, msg.sender, playerIdx);

        // If only one player left, they win immediately
        if (ps.activePlayers == 1) {
            uint8 winnerIdx = _findLastActivePlayer(matchId);
            _settleMatchSingleWinner(matchId, winnerIdx);
            return;
        }

        if (_isBettingComplete(matchId)) {
            ps.phase = Phase.REVEAL;
            ps.revealDeadline = block.timestamp + REVEAL_WINDOW;
        } else {
            _advanceTurn(matchId);
        }
    }

    // --- REVEAL PHASE ---

    function revealMove(uint256 matchId, bytes32 move, bytes32 salt) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.REVEAL, "Not reveal phase");
        require(block.timestamp <= ps.revealDeadline, "Reveal timeout");
        require(_isPlayer(matchId, msg.sender), "Not player");

        RoundCommit storage rc = roundCommits[matchId][m.currentRound][msg.sender];
        require(rc.commitHash != bytes32(0), "Not committed");
        require(!rc.revealed, "Already revealed");

        bytes32 expectedHash = keccak256(abi.encodePacked(
            "FALKEN_V4", address(this), matchId, uint256(m.currentRound), msg.sender, move, salt
        ));
        require(expectedHash == rc.commitHash, "Invalid hash");

        rc.move = move;
        rc.salt = salt;
        rc.revealed = true;
        roundRevealCount[matchId][m.currentRound]++;

        emit MoveRevealed(matchId, m.currentRound, msg.sender, move);
    }

    // --- REFEREE RESOLUTION ---

    function resolveStreet(uint256 matchId, uint8 streetWinnerIdx) external onlyReferee {
        _requireMatchExists(matchId);
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(roundRevealCount[matchId][m.currentRound] == ps.activePlayers, "Not all revealed");
        require(streetWinnerIdx == 255 || !ps.folded[streetWinnerIdx], "Winner folded");

        if (streetWinnerIdx != 255) {
            m.wins[streetWinnerIdx]++;
        }

        emit RoundResolved(matchId, m.currentRound, streetWinnerIdx);

        // Check if match is complete
        if (streetWinnerIdx != 255 && m.wins[streetWinnerIdx] >= m.winsRequired) {
            _settleMatchSingleWinner(matchId, streetWinnerIdx);
            return;
        }

        if (m.currentRound >= m.maxRounds) {
            _settleByMostWins(matchId);
            return;
        }

        // Advance to next street
        _advanceToNextStreet(matchId);
    }

    // --- ADMIN ---

    function setReferee(address newReferee) external onlyOwner {
        require(newReferee != address(0), "Invalid referee");
        emit RefereeChanged(referee, newReferee);
        referee = newReferee;
    }

    // --- INTERNAL FUNCTIONS ---

    function _advanceTurn(uint256 matchId) internal {
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        do {
            ps.currentTurnIndex = (ps.currentTurnIndex + 1) % uint8(m.players.length);
        } while (ps.folded[ps.currentTurnIndex]);

        ps.betDeadline = block.timestamp + BET_WINDOW;
    }

    function _advanceToNextActivePlayer(uint256 matchId) internal {
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        while (ps.folded[ps.currentTurnIndex]) {
            ps.currentTurnIndex = (ps.currentTurnIndex + 1) % uint8(m.players.length);
        }
    }

    function _advanceToNextStreet(uint256 matchId) internal {
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        // Cleanup current round
        for (uint i = 0; i < m.players.length; i++) {
            delete roundCommits[matchId][m.currentRound][m.players[i]];
        }
        delete roundCommitCount[matchId][m.currentRound];
        delete roundRevealCount[matchId][m.currentRound];

        // Reset betting state
        ps.currentBet = 0;
        ps.raiseCount = 0;
        ps.currentTurnIndex = 0;
        for (uint i = 0; i < m.players.length; i++) {
            ps.playerBets[i] = 0;
        }

        // Advance street or round
        if (ps.street + 1 < ps.maxStreets) {
            ps.street++;
        } else {
            ps.street = 0;
            m.currentRound++;
        }

        ps.phase = Phase.COMMIT;
        ps.commitDeadline = block.timestamp + COMMIT_WINDOW;

        emit StreetAdvanced(matchId, ps.street, ps.phase);
    }

    function _isBettingComplete(uint256 matchId) internal view returns (bool) {
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        // Check all active players have acted and bets are equal
        for (uint i = 0; i < m.players.length; i++) {
            if (!ps.folded[i]) {
                if (ps.playerBets[i] < ps.currentBet) {
                    return false;
                }
            }
        }
        return true;
    }

    function _calculateStreetPot(uint256 matchId) internal view returns (uint256) {
        PokerState storage ps = pokerState[matchId];
        uint256 streetPot = 0;
        for (uint i = 0; i < ps.playerBets.length; i++) {
            streetPot += ps.playerBets[i];
        }
        return streetPot;
    }

    function _findLastActivePlayer(uint256 matchId) internal view returns (uint8) {
        PokerState storage ps = pokerState[matchId];
        for (uint8 i = 0; i < uint8(ps.folded.length); i++) {
            if (!ps.folded[i]) {
                return i;
            }
        }
        revert("No active players");
    }

    function _settleByMostWins(uint256 matchId) internal {
        BaseMatch storage m = matches[matchId];

        uint8 maxWins = 0;
        uint8 winnerIdx = 255;
        bool tie = false;

        for (uint8 i = 0; i < uint8(m.wins.length); i++) {
            if (m.wins[i] > maxWins) {
                maxWins = m.wins[i];
                winnerIdx = i;
                tie = false;
            } else if (m.wins[i] == maxWins && maxWins > 0) {
                tie = true;
            }
        }

        if (tie || winnerIdx == 255) {
            _settleMatchDraw(matchId);
        } else {
            _settleMatchSingleWinner(matchId, winnerIdx);
        }
    }

    // Override internal timeout functions
    function _claimTimeout(uint256 matchId) internal override {
        PokerState storage ps = pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        if (ps.phase == Phase.COMMIT) {
            // Last player to commit wins
            for (uint8 i = 0; i < uint8(m.players.length); i++) {
                if (roundCommits[matchId][m.currentRound][m.players[i]].commitHash != bytes32(0)) {
                    _settleMatchSingleWinner(matchId, i);
                    return;
                }
            }
        } else if (ps.phase == Phase.BET) {
            // Player who acted last (not current turn) wins
            uint8 lastActorIdx = (ps.currentTurnIndex + uint8(m.players.length) - 1) % uint8(m.players.length);
            while (ps.folded[lastActorIdx]) {
                lastActorIdx = (lastActorIdx + uint8(m.players.length) - 1) % uint8(m.players.length);
            }
            _settleMatchSingleWinner(matchId, lastActorIdx);
        } else if (ps.phase == Phase.REVEAL) {
            // Last player to reveal wins
            for (uint8 i = 0; i < uint8(m.players.length); i++) {
                if (roundCommits[matchId][m.currentRound][m.players[i]].revealed) {
                    _settleMatchSingleWinner(matchId, i);
                    return;
                }
            }
        }
    }

    function _mutualTimeout(uint256 matchId) internal override {
        BaseMatch storage m = matches[matchId];
        m.status = MatchStatus.VOIDED;

        uint256 refund = (m.stake * 99) / 100;
        uint256 penalty = m.stake - refund;

        for (uint i = 0; i < m.players.length; i++) {
            _safeTransferUSDC(m.players[i], refund);
        }

        _safeTransferUSDC(treasury, penalty * m.players.length);

        emit MatchVoided(matchId, "Mutual timeout");
    }
}
