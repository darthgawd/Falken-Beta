// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./MatchEscrow.sol";
import "./LogicRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FiseEscrow
 * @dev Extension of MatchEscrow to support the Falken Immutable Scripting Engine (FISE).
 * Architected for N-player scalability.
 */
contract FiseEscrow is MatchEscrow {
    using SafeERC20 for IERC20;
    
    LogicRegistry public immutable logicRegistry;
    address public referee;

    // Default wins required for multi-round games (like Poker)
    uint8 public constant DEFAULT_WINS_REQUIRED = 3;
    uint8 public constant DRAW_INDEX = 255;
    uint8 public constant MAX_CONSECUTIVE_DRAWS = 3;
    uint16 public constant ROYALTY_BPS = 200; // 2% developer royalty

    event RefereeChanged(address indexed oldReferee, address indexed newReferee);
    event RoundStarted(uint256 indexed matchId, uint8 round);

    modifier onlyReferee() {
        require(msg.sender == referee, "Only Referee can call");
        _;
    }

    constructor(
        address initialTreasury, 
        address usdcAddress, 
        address initialLogicRegistry,
        address initialReferee
    ) MatchEscrow(initialTreasury, usdcAddress) {
        require(initialLogicRegistry != address(0), "Invalid registry");
        require(initialReferee != address(0), "Invalid referee");
        logicRegistry = LogicRegistry(initialLogicRegistry);
        referee = initialReferee;
    }

    /**
     * @dev Sets a new authorized referee address (Falken VM).
     */
    function setReferee(address newReferee) external onlyOwner {
        require(newReferee != address(0), "Invalid referee");
        emit RefereeChanged(referee, newReferee);
        referee = newReferee;
    }

    /**
     * @dev Creates a match using FISE logicId and configurable maxPlayers.
     * @param stake Entry stake in USDC.
     * @param logicId The registered ID from LogicRegistry.
     * @param maxPlayers Number of players needed to start.
     * @param winsRequired Rounds needed to win (1 for single-round, 3 for best-of-5, etc.)
     */
    function createMatch(uint256 stake, bytes32 logicId, uint8 maxPlayers, uint8 winsRequired) external nonReentrant whenNotPaused {
        require(winsRequired > 0, "Wins required must be > 0");
        require(stake > 0, "Stake must be > 0");
        require(maxPlayers >= 2, "Minimum 2 players");
        
        // 1. Verify Logic exists in Registry
        (string memory cid,,,,) = logicRegistry.registry(logicId);
        require(bytes(cid).length > 0, "Logic ID not registered");

        // 2. Pull USDC from creator
        usdc.safeTransferFrom(msg.sender, address(this), stake);

        uint256 matchId = ++matchCounter;
        
        // Initialize dynamic players array
        Match storage m = matches[matchId];
        m.players.push(msg.sender);
        m.stake = stake;
        m.logicId = logicId;
        m.maxPlayers = maxPlayers;
        m.currentRound = 1;
        m.phase = Phase.COMMIT;
        m.status = MatchStatus.OPEN;
        
        // Initialize wins array and set winsRequired (creator chooses)
        for (uint256 i = 0; i < maxPlayers; i++) {
            m.wins.push(0);
        }
        m.winsRequired = winsRequired;

        // Set initial total pot and contribution
        m.totalPot = stake;
        playerContributions[matchId][msg.sender] = stake;

        emit MatchCreated(matchId, msg.sender, stake, logicId, maxPlayers, winsRequired);
    }

    /**
     * @dev Implementation of round resolution for FISE.
     * Waits for Referee to call resolveFiseRound.
     */
    function _resolveRound(uint256 /*matchId*/) internal override {
        // Asynchronous resolution via Referee
        return;
    }

    /**
     * @dev Authorized Referee call to resolve a single FISE round.
     * @param roundWinnerIndex The index of the player who won the round (0 to maxPlayers-1).
     * Use 255 for a DRAW.
     */
    function resolveFiseRound(uint256 matchId, uint8 roundWinnerIndex) external nonReentrant onlyReferee {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(m.phase == Phase.REVEAL, "Not in reveal phase");
        require(roundRevealCount[matchId][m.currentRound] == m.maxPlayers, "Not everyone revealed");

        if (roundWinnerIndex != DRAW_INDEX) {
            require(roundWinnerIndex < m.maxPlayers, "Invalid winner index");
            m.wins[roundWinnerIndex]++;
            m.drawCounter = 0;
        } else {
            m.drawCounter++;
        }

        emit RoundResolved(matchId, m.currentRound, roundWinnerIndex);

        // Cleanup round storage
        for (uint256 i = 0; i < m.players.length; i++) {
            delete roundCommits[matchId][m.currentRound][m.players[i]];
        }
        delete roundRevealCount[matchId][m.currentRound];
        delete roundCommitCount[matchId][m.currentRound];

        // Check for match completion
        // For N-player, we settle if someone hits 3 wins or if max rounds reached
        bool matchFinished = false;
        if (roundWinnerIndex != DRAW_INDEX && m.wins[roundWinnerIndex] >= m.winsRequired) {
            matchFinished = true;
        } else if (m.currentRound >= MAX_ROUNDS) {
            matchFinished = true;
        }

        if (matchFinished) {
            _settleFiseMatch(matchId);
            return;
        }

        // Handle progression
        if (roundWinnerIndex == DRAW_INDEX && m.drawCounter < MAX_CONSECUTIVE_DRAWS) {
            // Sudden death replay same round
        } else {
            m.currentRound++;
            m.drawCounter = 0;
        }

        m.phase = Phase.COMMIT;
        m.commitDeadline = block.timestamp + COMMIT_WINDOW;
        emit RoundStarted(matchId, m.currentRound);
    }

    /**
     * @dev Settles FISE match with developer royalties.
     */
    function _settleFiseMatch(uint256 matchId) internal {
        Match storage m = matches[matchId];
        
        // 1. Identify Match Winner
        uint8 winnerIndex = DRAW_INDEX; // Default to Draw
        uint8 maxWins = 0;
        for (uint8 i = 0; i < m.wins.length; i++) {
            if (m.wins[i] > maxWins) {
                maxWins = m.wins[i];
                winnerIndex = i;
            } else if (m.wins[i] == maxWins && maxWins > 0) {
                winnerIndex = DRAW_INDEX; // Tied
            }
        }

        // 2. Record volume in LogicRegistry
        logicRegistry.recordVolume(m.logicId, m.totalPot);

        // 3. Payout to winners (delegates to MatchEscrow for rake/transfer)
        _settleMatch(matchId, winnerIndex);
    }
}
