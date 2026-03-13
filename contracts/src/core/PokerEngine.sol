// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./BaseEscrow.sol";
import "./LogicRegistry.sol";

/**
 * @title PokerEngine
 * @dev Extension of BaseEscrow for multi-street poker with betting.
 * Supports: 5-Card Draw (1 street), Hold'em/Omaha (4 streets), 7-Card Stud (5 streets).
 *
 * ARCHITECTURE:
 * - Uses _initMatch() for all common setup (stake validation, creator auto-join, etc.)
 * - Uses _onMatchActivated() hook to set commit deadline when match fills
 * - Uses _addContribution() on every raise/call for accurate admin refunds
 * - BaseEscrow's joinMatch handles player joining — NOT overridden here
 *
 * PHASE FLOW PER STREET:
 *   COMMIT → BET → REVEAL → referee advances/resolves
 *
 * BETTING:
 *   - currentBet = bet LEVEL (total each player must have in this street)
 *   - playersToAct tracks completion: set to activePlayers on BET start,
 *     decremented on check/call/fold, reset to activePlayers-1 on raise
 *   - MAX_RAISES = 2 per street (raise + re-raise, then call/fold)
 *   - maxBuyIn caps total contribution per player (prevents whale attacks)
 */
contract PokerEngine is BaseEscrow {
    using SafeERC20 for IERC20;

    // --- CONSTANTS ---
    uint8 public constant MAX_RAISES = 2;
    uint256 public constant BET_WINDOW = 30 minutes;
    uint256 public constant COMMIT_WINDOW = 30 minutes;
    uint256 public constant REVEAL_WINDOW = 30 minutes;

    // --- ENUMS ---
    enum Phase { COMMIT, BET, REVEAL }
    enum BetStructure { NO_LIMIT, POT_LIMIT, FIXED_LIMIT }

    // --- STATE ---
    struct PokerState {
        Phase phase;
        BetStructure betStructure;  // NO_LIMIT, POT_LIMIT, FIXED_LIMIT
        uint8 maxStreets;           // from LogicRegistry (1-5)
        uint8 street;               // current street (0 to maxStreets-1)
        uint8 activePlayers;        // players who haven't folded
        uint8 raiseCount;           // raises this street (0 to MAX_RAISES)
        uint8 playersToAct;         // countdown for betting completion
        uint256 currentBet;         // bet level this street
        uint256 maxBuyIn;           // max total contribution per player
        uint256 commitDeadline;
        uint256 betDeadline;
        uint256 revealDeadline;
        bool[] folded;              // per player fold status (resets each round)
        uint256[] streetBets;       // per player bet amount this street
    }

    struct RoundCommit {
        bytes32 commitHash;
        bytes32 move;
        bytes32 salt;
        bool revealed;
    }

    LogicRegistry public immutable LOGIC_REGISTRY;
    address public referee;

    mapping(uint256 => PokerState) internal _pokerState;
    mapping(uint256 => mapping(uint8 => mapping(address => RoundCommit))) public roundCommits;
    // round → commit count
    mapping(uint256 => mapping(uint8 => uint8)) public roundCommitCount;
    // round → reveal count
    mapping(uint256 => mapping(uint8 => uint8)) public roundRevealCount;

    // --- EVENTS ---
    event RefereeChanged(address indexed oldReferee, address indexed newReferee);
    event StreetAdvanced(uint256 indexed matchId, uint8 round, uint8 newStreet);
    event BetPlaced(uint256 indexed matchId, address indexed player, bet_action action, uint256 amount);
    event PlayerFolded(uint256 indexed matchId, address indexed player, uint8 playerIndex);
    event MoveCommitted(uint256 indexed matchId, uint8 round, address indexed player);
    event MoveRevealed(uint256 indexed matchId, uint8 round, address indexed player, bytes32 move);
    event RoundResolved(uint256 indexed matchId, uint8 round, uint8 winnerIndex);

    // Bet action enum for events (matches DB schema)
    enum bet_action { CHECK, CALL, RAISE, FOLD, ALL_IN }

    // --- MODIFIERS ---
    modifier onlyReferee() {
        require(msg.sender == referee, "Only referee");
        _;
    }

    // --- CONSTRUCTOR ---
    constructor(
        address initialTreasury,
        address usdcAddress,
        address logicRegistry,
        address initialReferee
    ) BaseEscrow(initialTreasury, usdcAddress) {
        require(logicRegistry != address(0), "Invalid registry");
        require(initialReferee != address(0), "Invalid referee");
        LOGIC_REGISTRY = LogicRegistry(logicRegistry);
        referee = initialReferee;
    }

    // --- DEV ROYALTY HOOK ---

    function _getLogicDeveloper(bytes32 logicId) internal virtual override returns (address) {
        return LOGIC_REGISTRY.getDeveloper(logicId);
    }

    function _recordVolume(bytes32 logicId, uint256 amount) internal virtual override {
        // Best-effort — never revert settlement if registry call fails
        try LOGIC_REGISTRY.recordVolume(logicId, amount) {} catch {}
    }

    // --- MATCH CREATION ---

    /**
     * @dev Create a poker match. Uses _initMatch() for all common setup.
     * Child adds: poker state, maxStreets from registry, bet structure, maxBuyIn.
     * NOTE: Child createMatch needs its own nonReentrant + whenNotPaused.
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
        // Validate poker config
        require(maxBuyIn >= stake, "Max buy-in must cover stake");

        LogicRegistry.GameLogic memory logic = LOGIC_REGISTRY.getGameLogic(logicId);
        require(logic.bettingEnabled, "Game does not support betting");
        require(logic.maxStreets > 0, "Invalid max streets");

        // BaseEscrow handles: stake validation, creator auto-join, wins array,
        // matchCounter increment, createdAt, MatchCreated + PlayerJoined events
        uint256 matchId = _initMatch(stake, logicId, maxPlayers, winsRequired, maxRounds);

        // Initialize poker state
        PokerState storage ps = _pokerState[matchId];
        ps.betStructure = betStructure;
        ps.maxStreets = logic.maxStreets;
        ps.activePlayers = maxPlayers; // correct once match fills
        ps.maxBuyIn = maxBuyIn;
        ps.folded = new bool[](maxPlayers);
        ps.streetBets = new uint256[](maxPlayers);
        // Phase and deadlines set in _onMatchActivated when match fills
    }

    /**
     * @dev Hook called by BaseEscrow.joinMatch when match becomes ACTIVE.
     * Sets the first commit deadline — game begins.
     */
    function _onMatchActivated(uint256 matchId) internal override {
        PokerState storage ps = _pokerState[matchId];
        ps.phase = Phase.COMMIT;
        ps.commitDeadline = block.timestamp + COMMIT_WINDOW;
    }

    // --- COMMIT PHASE ---

    function commitMove(uint256 matchId, bytes32 commitHash) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.COMMIT, "Not commit phase");
        require(block.timestamp <= ps.commitDeadline, "Commit timed out");
        require(_isPlayer(matchId, msg.sender), "Not player");

        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(!ps.folded[playerIdx], "You folded");
        require(
            roundCommits[matchId][m.currentRound][msg.sender].commitHash == bytes32(0),
            "Already committed"
        );

        roundCommits[matchId][m.currentRound][msg.sender] = RoundCommit({
            commitHash: commitHash,
            move: bytes32(0),
            salt: bytes32(0),
            revealed: false
        });

        roundCommitCount[matchId][m.currentRound]++;
        emit MoveCommitted(matchId, m.currentRound, msg.sender);

        // All active (non-folded) players committed → advance to BET
        if (roundCommitCount[matchId][m.currentRound] == ps.activePlayers) {
            ps.phase = Phase.BET;
            ps.betDeadline = block.timestamp + BET_WINDOW;
            ps.currentBet = 0;
            ps.raiseCount = 0;
            ps.playersToAct = ps.activePlayers;
            // Find first active player
            _setTurnToFirstActive(matchId);
        }
    }

    // --- BET PHASE ---

    function raise(uint256 matchId, uint256 raiseAmount) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");
        require(block.timestamp <= ps.betDeadline, "Bet timed out");
        require(ps.raiseCount < MAX_RAISES, "Max raises reached");
        require(raiseAmount > 0, "Raise must be > 0");

        uint8 playerIdx = _requireCurrentTurn(matchId);

        // Enforce bet structure limits
        if (ps.betStructure == BetStructure.FIXED_LIMIT) {
            require(raiseAmount == m.stake, "Fixed limit: raise must equal stake");
        } else if (ps.betStructure == BetStructure.POT_LIMIT) {
            require(raiseAmount <= m.totalPot, "Pot limit exceeded");
        }
        // NO_LIMIT: any amount (capped by maxBuyIn below)

        // Calculate new bet level and what this player owes
        uint256 newBetLevel = ps.currentBet + raiseAmount;
        uint256 amountOwed = newBetLevel - ps.streetBets[playerIdx];

        // Enforce max buy-in
        require(
            playerContributions[matchId][msg.sender] + amountOwed <= ps.maxBuyIn,
            "Exceeds max buy-in"
        );

        // Pull USDC and track contribution
        usdc.safeTransferFrom(msg.sender, address(this), amountOwed);
        _addContribution(matchId, msg.sender, amountOwed);

        // Update state
        ps.streetBets[playerIdx] = newBetLevel;
        ps.currentBet = newBetLevel;
        ps.raiseCount++;

        // Everyone else needs to act again
        ps.playersToAct = ps.activePlayers - 1;

        emit BetPlaced(matchId, msg.sender, bet_action.RAISE, amountOwed);

        _advanceTurn(matchId);
    }

    function call(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");
        require(block.timestamp <= ps.betDeadline, "Bet timed out");

        uint8 playerIdx = _requireCurrentTurn(matchId);

        uint256 amountOwed = ps.currentBet - ps.streetBets[playerIdx];
        require(amountOwed > 0, "Nothing to call");

        // Enforce max buy-in
        require(
            playerContributions[matchId][msg.sender] + amountOwed <= ps.maxBuyIn,
            "Exceeds max buy-in"
        );

        // Pull USDC and track contribution
        usdc.safeTransferFrom(msg.sender, address(this), amountOwed);
        _addContribution(matchId, msg.sender, amountOwed);

        ps.streetBets[playerIdx] = ps.currentBet;
        ps.playersToAct--;

        emit BetPlaced(matchId, msg.sender, bet_action.CALL, amountOwed);

        if (ps.playersToAct == 0) {
            _transitionToReveal(matchId);
        } else {
            _advanceTurn(matchId);
        }
    }

    function check(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");
        require(block.timestamp <= ps.betDeadline, "Bet timed out");

        uint8 playerIdx = _requireCurrentTurn(matchId);
        require(ps.streetBets[playerIdx] == ps.currentBet, "Must call or raise");

        ps.playersToAct--;

        emit BetPlaced(matchId, msg.sender, bet_action.CHECK, 0);

        if (ps.playersToAct == 0) {
            _transitionToReveal(matchId);
        } else {
            _advanceTurn(matchId);
        }
    }

    function fold(uint256 matchId) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.BET, "Not bet phase");

        uint8 playerIdx = _requireCurrentTurn(matchId);

        ps.folded[playerIdx] = true;
        ps.activePlayers--;
        ps.playersToAct--;

        emit PlayerFolded(matchId, msg.sender, playerIdx);

        // Last player standing wins immediately
        if (ps.activePlayers == 1) {
            _settleMatchSingleWinner(matchId, _findLastActivePlayer(matchId));
            return;
        }

        if (ps.playersToAct == 0) {
            _transitionToReveal(matchId);
        } else {
            _advanceTurn(matchId);
        }
    }

    // --- REVEAL PHASE ---

    function revealMove(
        uint256 matchId,
        bytes32 move,
        bytes32 salt
    ) external nonReentrant whenNotPaused {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(ps.phase == Phase.REVEAL, "Not reveal phase");
        require(block.timestamp <= ps.revealDeadline, "Reveal timed out");
        require(_isPlayer(matchId, msg.sender), "Not player");

        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(!ps.folded[playerIdx], "You folded");

        RoundCommit storage rc = roundCommits[matchId][m.currentRound][msg.sender];
        require(rc.commitHash != bytes32(0), "Not committed");
        require(!rc.revealed, "Already revealed");

        // Verify commit hash
        bytes32 expectedHash = keccak256(abi.encodePacked(
            "FALKEN_V4", address(this), matchId, uint256(m.currentRound), msg.sender, move, salt
        ));
        require(expectedHash == rc.commitHash, "Invalid reveal");

        rc.move = move;
        rc.salt = salt;
        rc.revealed = true;
        roundRevealCount[matchId][m.currentRound]++;

        emit MoveRevealed(matchId, m.currentRound, msg.sender, move);
    }

    // --- REFEREE RESOLUTION ---

    /**
     * @dev Advance to next street within the same round.
     * Called by referee after intermediate street reveals.
     */
    function advanceStreet(uint256 matchId) external onlyReferee nonReentrant {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(
            roundRevealCount[matchId][m.currentRound] == ps.activePlayers,
            "Not all revealed"
        );
        require(ps.street + 1 < ps.maxStreets, "Already on last street");

        // Advance street
        ps.street++;
        _resetStreetState(matchId);
        ps.phase = Phase.COMMIT;
        ps.commitDeadline = block.timestamp + COMMIT_WINDOW;

        emit StreetAdvanced(matchId, m.currentRound, ps.street);
    }

    /**
     * @dev Resolve the current round (poker hand).
     * Called by referee after the final street's reveals.
     * @param roundWinnerIdx Player index who won, or 255 for draw.
     */
    function resolveRound(uint256 matchId, uint8 roundWinnerIdx) external onlyReferee nonReentrant {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(
            roundRevealCount[matchId][m.currentRound] == ps.activePlayers,
            "Not all revealed"
        );

        // Update wins
        if (roundWinnerIdx == 255) {
            m.drawCounter++;
        } else {
            require(roundWinnerIdx < m.players.length, "Invalid winner");
            require(!ps.folded[roundWinnerIdx], "Winner folded");
            m.wins[roundWinnerIdx]++;
        }

        emit RoundResolved(matchId, m.currentRound, roundWinnerIdx);

        // Check match completion
        if (roundWinnerIdx != 255 && m.wins[roundWinnerIdx] >= m.winsRequired) {
            _settleMatchSingleWinner(matchId, roundWinnerIdx);
            return;
        }

        if (m.currentRound >= m.maxRounds) {
            _settleByMostWins(matchId);
            return;
        }

        // Start next round (new poker hand)
        _startNextRound(matchId);
    }

    /**
     * @dev Resolve the current round with a split pot.
     * Called by referee when pot must be divided between multiple winners (e.g., Omaha Hi-Lo, tie hands).
     * Settles the match immediately — does not continue to next round.
     */
    function resolveRoundSplit(
        uint256 matchId,
        IBaseEscrow.Resolution calldata res
    ) external onlyReferee nonReentrant {
        _requireMatchExists(matchId);
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        require(m.status == MatchStatus.ACTIVE, "Not active");
        require(
            roundRevealCount[matchId][m.currentRound] == ps.activePlayers,
            "Not all revealed"
        );
        require(res.winnerIndices.length >= 2, "Use resolveRound for single winner");

        // Validate no folded winners
        for (uint i = 0; i < res.winnerIndices.length; i++) {
            require(res.winnerIndices[i] < m.players.length, "Invalid winner index");
            require(!ps.folded[res.winnerIndices[i]], "Winner folded");
        }

        emit RoundResolved(matchId, m.currentRound, 255); // 255 = draw/split

        _settleMatch(matchId, res);
    }

    // --- ADMIN ---

    function setReferee(address newReferee) external onlyOwner {
        require(newReferee != address(0), "Invalid referee");
        emit RefereeChanged(referee, newReferee);
        referee = newReferee;
    }

    // --- TIMEOUT OVERRIDES ---

    /**
     * @dev Claim timeout. The player who did their job wins.
     * Timeouts always settle the match — no partial continuation.
     */
    function _claimTimeout(uint256 matchId) internal override {
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];
        uint8 claimerIdx = uint8(_findPlayerIndex(matchId, msg.sender));

        if (ps.phase == Phase.COMMIT) {
            require(block.timestamp > ps.commitDeadline, "Not timed out");
            require(
                roundCommits[matchId][m.currentRound][msg.sender].commitHash != bytes32(0),
                "You did not commit"
            );
            emit TimeoutClaimed(matchId, msg.sender, claimerIdx);
            _settleMatchSingleWinner(matchId, claimerIdx);

        } else if (ps.phase == Phase.BET) {
            require(block.timestamp > ps.betDeadline, "Not timed out");
            require(!ps.folded[claimerIdx], "You folded");
            require(claimerIdx != _currentTurn[matchId], "You are the one who timed out");
            emit TimeoutClaimed(matchId, msg.sender, claimerIdx);
            _settleMatchSingleWinner(matchId, claimerIdx);

        } else if (ps.phase == Phase.REVEAL) {
            require(block.timestamp > ps.revealDeadline, "Not timed out");
            require(
                roundCommits[matchId][m.currentRound][msg.sender].revealed,
                "You did not reveal"
            );
            emit TimeoutClaimed(matchId, msg.sender, claimerIdx);
            _settleMatchSingleWinner(matchId, claimerIdx);
        }
    }

    /**
     * @dev Mutual timeout. Refunds each player's full contribution minus penalty.
     * Uses playerContributions (tracks stake + all raises via _addContribution).
     */
    function _mutualTimeout(uint256 matchId) internal override {
        BaseMatch storage m = matches[matchId];
        m.status = MatchStatus.VOIDED;

        for (uint i = 0; i < m.players.length; i++) {
            address player = m.players[i];
            uint256 contrib = playerContributions[matchId][player];
            if (contrib == 0) continue;

            uint256 penalty = (contrib * MUTUAL_TIMEOUT_PENALTY_BPS) / 10000;
            uint256 refund = contrib - penalty;

            playerContributions[matchId][player] = 0;
            _safeTransferUSDC(player, refund);
            _safeTransferUSDC(treasury, penalty);
        }

        emit MatchVoided(matchId, "Mutual timeout");
    }

    // --- VIEW FUNCTIONS ---

    function getPokerState(uint256 matchId) external view returns (PokerState memory) {
        return _pokerState[matchId];
    }

    function isPlayerFolded(uint256 matchId, uint8 playerIndex) external view returns (bool) {
        PokerState storage ps = _pokerState[matchId];
        if (playerIndex >= ps.folded.length) return false;
        return ps.folded[playerIndex];
    }

    function getPlayerStreetBet(uint256 matchId, uint8 playerIndex) external view returns (uint256) {
        PokerState storage ps = _pokerState[matchId];
        if (playerIndex >= ps.streetBets.length) return 0;
        return ps.streetBets[playerIndex];
    }

    function getCurrentTurnIndex(uint256 matchId) external view returns (uint8) {
        return _currentTurn[matchId];
    }

    // --- INTERNAL HELPERS ---

    // Turn tracking — stored separately since dynamic arrays in struct
    // can't hold all state cleanly
    mapping(uint256 => uint8) internal _currentTurn;

    function _requireCurrentTurn(uint256 matchId) internal view returns (uint8) {
        PokerState storage ps = _pokerState[matchId];
        uint8 playerIdx = uint8(_findPlayerIndex(matchId, msg.sender));
        require(!ps.folded[playerIdx], "You folded");
        require(playerIdx == _currentTurn[matchId], "Not your turn");
        return playerIdx;
    }

    function _setTurnToFirstActive(uint256 matchId) internal {
        PokerState storage ps = _pokerState[matchId];
        BaseMatch storage m = matches[matchId];
        for (uint8 i = 0; i < uint8(m.players.length); i++) {
            if (!ps.folded[i]) {
                _currentTurn[matchId] = i;
                return;
            }
        }
    }

    function _advanceTurn(uint256 matchId) internal {
        PokerState storage ps = _pokerState[matchId];
        BaseMatch storage m = matches[matchId];
        uint8 current = _currentTurn[matchId];

        for (uint8 i = 1; i <= uint8(m.players.length); i++) {
            uint8 next = (current + i) % uint8(m.players.length);
            if (!ps.folded[next]) {
                _currentTurn[matchId] = next;
                ps.betDeadline = block.timestamp + BET_WINDOW;
                return;
            }
        }
    }

    function _transitionToReveal(uint256 matchId) internal {
        PokerState storage ps = _pokerState[matchId];
        ps.phase = Phase.REVEAL;
        ps.revealDeadline = block.timestamp + REVEAL_WINDOW;
    }

    function _resetStreetState(uint256 matchId) internal {
        PokerState storage ps = _pokerState[matchId];
        BaseMatch storage m = matches[matchId];

        ps.currentBet = 0;
        ps.raiseCount = 0;
        ps.playersToAct = 0;

        // Reset round commit/reveal tracking for new street
        // (commits are per-round, but we reuse round number with street tracking)
        for (uint i = 0; i < m.players.length; i++) {
            ps.streetBets[i] = 0;
            delete roundCommits[matchId][m.currentRound][m.players[i]];
        }
        roundCommitCount[matchId][m.currentRound] = 0;
        roundRevealCount[matchId][m.currentRound] = 0;
    }

    function _startNextRound(uint256 matchId) internal {
        BaseMatch storage m = matches[matchId];
        PokerState storage ps = _pokerState[matchId];

        // Reset for next hand
        m.currentRound++;
        ps.street = 0;
        ps.activePlayers = uint8(m.players.length);

        // Reset folds (new hand = everyone back in)
        for (uint8 i = 0; i < uint8(m.players.length); i++) {
            ps.folded[i] = false;
        }

        _resetStreetState(matchId);
        ps.phase = Phase.COMMIT;
        ps.commitDeadline = block.timestamp + COMMIT_WINDOW;
    }

    function _findLastActivePlayer(uint256 matchId) internal view returns (uint8) {
        PokerState storage ps = _pokerState[matchId];
        for (uint8 i = 0; i < uint8(ps.folded.length); i++) {
            if (!ps.folded[i]) return i;
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
}
