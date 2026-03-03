// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./MatchEscrow.sol";
import "./LogicRegistry.sol";

/**
 * @title FiseEscrow
 * @dev Extension of MatchEscrow to support the Falken Immutable Scripting Engine (FISE).
 * Allows match settlement via authorized off-chain Referees (Falken VM).
 * 
 * Multi-Round Support: Best-of-5 (first to 3 wins), draws replay up to 3 times.
 */
contract FiseEscrow is MatchEscrow {
    
    LogicRegistry public immutable logicRegistry;
    address public referee;

    // Mapping from matchId to the FISE Logic ID (IPFS CID Hash)
    mapping(uint256 => bytes32) public fiseMatches;

    // Wins required for FISE matches (best-of-5 = first to 3)
    uint8 public constant FISE_WINS_REQUIRED = 3;

    event FiseMatchCreated(uint256 indexed matchId, bytes32 indexed logicId);
    event RefereeChanged(address indexed oldReferee, address indexed newReferee);
    event RoundStarted(uint256 indexed matchId, uint8 round);

    modifier onlyReferee() {
        require(msg.sender == referee, "Only Referee can call");
        _;
    }

    constructor(
        address initialTreasury, 
        address initialPriceProvider, 
        address initialLogicRegistry,
        address initialReferee
    ) MatchEscrow(initialTreasury, initialPriceProvider) {
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
     * @dev Creates a match using FISE JavaScript logic instead of a Solidity contract.
     * @param stake Entry stake in Wei.
     * @param logicId The registered ID from LogicRegistry.
     */
    function createFiseMatch(uint256 stake, bytes32 logicId) external payable nonReentrant whenNotPaused {
        require(msg.value == stake, "Incorrect stake amount");
        
        // 1. Verify Logic exists in Registry
        (string memory cid,,,,) = logicRegistry.registry(logicId);
        require(bytes(cid).length > 0, "Logic ID not registered");

        // 2. Validate USD floor
        uint256 usdValue = priceProvider.getUsdValue(stake);
        require(usdValue >= priceProvider.getMinStakeUsd(), "Stake below minimum");

        // 3. Initialize basic match state in parent
        uint256 matchId = ++matchCounter;

        // Note: We use address(this) as a sentinel for gameLogic to indicate FISE
        matches[matchId] = Match({
            playerA: msg.sender,
            playerB: address(0),
            stake: stake,
            gameLogic: address(this), 
            winsA: 0,
            winsB: 0,
            currentRound: 1,
            drawCounter: 0,
            phase: Phase.COMMIT,
            status: MatchStatus.OPEN,
            commitDeadline: 0,
            revealDeadline: 0
        });

        // 4. Map the match to its JS Logic
        fiseMatches[matchId] = logicId;

        emit MatchCreated(matchId, msg.sender, stake, address(this));
        emit FiseMatchCreated(matchId, logicId);
    }

    /**
     * @dev Override _resolveRound to prevent automatic resolution for FISE matches.
     * FISE matches are resolved round-by-round via resolveFiseRound() called by the Falken VM.
     */
    function _resolveRound(uint256 matchId) internal override {
        Match storage m = matches[matchId];
        
        // If this is a FISE match, do nothing here.
        // The Falken VM will call resolveFiseRound() after each round.
        if (m.gameLogic == address(this)) {
            return;
        }
        
        // For non-FISE matches, use the parent implementation
        super._resolveRound(matchId);
    }

    /**
     * @dev Resolves a single FISE round. Called by Referee after off-chain evaluation.
     * Mirrors MatchEscrow._resolveRound() but with winner determined off-chain.
     * 
     * @param matchId The match ID
     * @param roundWinner 0=draw, 1=playerA wins, 2=playerB wins
     */
    function resolveFiseRound(uint256 matchId, uint8 roundWinner) external onlyReferee nonReentrant {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(m.gameLogic == address(this), "Not a FISE match");
        require(roundWinner <= 2, "Invalid winner"); // 0=draw, 1=A, 2=B
        require(m.phase == Phase.REVEAL, "Not in reveal phase");

        // Update wins/draws (mirrors MatchEscrow._resolveRound)
        if (roundWinner == 1) {
            m.winsA++;
            m.drawCounter = 0;
        } else if (roundWinner == 2) {
            m.winsB++;
            m.drawCounter = 0;
        } else {
            m.drawCounter++;
        }

        emit RoundResolved(matchId, m.currentRound, roundWinner);

        // Cleanup round storage
        delete roundCommits[matchId][m.currentRound][m.playerA];
        delete roundCommits[matchId][m.currentRound][m.playerB];

        // Check for match winner (first to 3)
        if (m.winsA >= FISE_WINS_REQUIRED || m.winsB >= FISE_WINS_REQUIRED) {
            _settleFiseMatchInternal(matchId);
            return;
        }

        // Handle round progression
        if (roundWinner == 0) {
            // Draw — replay same round, up to 3 consecutive draws
            if (m.drawCounter >= 3) {
                // Sudden death limit reached, check max rounds
                if (m.currentRound >= MAX_ROUNDS) {
                    _settleFiseMatchInternal(matchId);
                    return;
                }
                // Advance to next round, reset draw counter
                m.currentRound++;
                m.drawCounter = 0;
            }
            // Else: stay on same round (sudden death replay)
        } else {
            // Non-draw — advance to next round
            if (m.currentRound >= MAX_ROUNDS) {
                _settleFiseMatchInternal(matchId);
                return;
            }
            m.currentRound++;
        }

        // Reset for next round
        m.phase = Phase.COMMIT;
        m.commitDeadline = block.timestamp + COMMIT_WINDOW;
        emit RoundStarted(matchId, m.currentRound);
    }

    /**
     * @dev Internal FISE settlement with developer royalties.
     * Called automatically when first-to-3 is reached or max rounds exceeded.
     */
    function _settleFiseMatchInternal(uint256 matchId) internal {
        Match storage m = matches[matchId];
        m.status = MatchStatus.SETTLED;
        m.phase = Phase.REVEAL; // Mark finished

        bytes32 logicId = fiseMatches[matchId];
        uint256 totalPot = m.stake * 2;

        // 1. Get Developer Info from Registry
        (, address developer,,,) = logicRegistry.registry(logicId);

        // 2. Record volume in registry
        logicRegistry.recordVolume(logicId, totalPot);

        // 3. Execute payouts (rake always taken, even on draws)
        uint256 totalRake = (totalPot * RAKE_BPS) / 10000;     // 5% total
        uint256 royalty = (totalPot * 200) / 10000;            // 2% Royalty
        uint256 protocolFee = totalRake - royalty;             // 3% Protocol
        
        // Pay rake first
        _safeTransfer(treasury, protocolFee);
        _safeTransfer(developer, royalty);

        if (m.winsA == m.winsB) {
            // Draw — split remaining pot equally (both get stake minus half rake)
            uint256 remainingPot = totalPot - totalRake;
            uint256 splitPayout = remainingPot / 2;
            _safeTransfer(m.playerA, splitPayout);
            _safeTransfer(m.playerB, splitPayout);
            emit MatchSettled(matchId, address(0), splitPayout);
        } else {
            address winner = m.winsA > m.winsB ? m.playerA : m.playerB;
            uint256 payout = totalPot - totalRake;
            _safeTransfer(winner, payout);
            emit MatchSettled(matchId, winner, payout);
        }
    }

    /**
     * @dev Legacy settle function for single-round FISE matches.
     * Can also be used to settle multi-round matches early (e.g., timeout, forfeit).
     * Only the authorized Referee can trigger settlement.
     */
    function settleFiseMatch(uint256 matchId, address winner) external onlyReferee nonReentrant {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.ACTIVE, "Match not active");
        require(m.gameLogic == address(this), "Not a FISE match");

        // Update state
        m.status = MatchStatus.SETTLED;
        m.phase = Phase.REVEAL;

        bytes32 logicId = fiseMatches[matchId];
        uint256 totalPot = m.stake * 2;

        // Get Developer Info
        (, address developer,,,) = logicRegistry.registry(logicId);

        // Record volume
        logicRegistry.recordVolume(logicId, totalPot);

        // Execute payouts (rake always taken, even on draws)
        uint256 totalRake = (totalPot * RAKE_BPS) / 10000;     // 5% total
        uint256 royalty = (totalPot * 200) / 10000;            // 2% Royalty
        uint256 protocolFee = totalRake - royalty;             // 3% Protocol
        
        // Pay rake first
        _safeTransfer(treasury, protocolFee);
        _safeTransfer(developer, royalty);

        if (winner == address(0)) {
            // Draw: split remaining pot equally
            uint256 remainingPot = totalPot - totalRake;
            uint256 splitPayout = remainingPot / 2;
            _safeTransfer(m.playerA, splitPayout);
            _safeTransfer(m.playerB, splitPayout);
            emit MatchSettled(matchId, address(0), splitPayout);
        } else {
            require(winner == m.playerA || winner == m.playerB, "Invalid winner");
            
            uint256 payout = totalPot - totalRake;
            _safeTransfer(winner, payout);

            emit MatchSettled(matchId, winner, payout);
        }
    }
}
