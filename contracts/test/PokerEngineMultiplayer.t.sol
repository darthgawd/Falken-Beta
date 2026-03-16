// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/PokerEngine.sol";
import "../src/core/LogicRegistry.sol";
import "./mocks/MockUSDC.sol";

/**
 * @title PokerEngineMultiplayerTest
 * @dev Tests for 3-player poker matches covering:
 *   - Phase transitions (COMMIT → BET → REVEAL)
 *   - Turn order, raise/call/fold mechanics
 *   - Rake on mid-game round pot distributions
 *   - Multi-round wins tracking and match settlement
 *   - Timeout fairness (all 3 phases, multi-player splits)
 *   - Split pot (resolveRoundSplit) validation
 *   - Accounting invariants (no overdraft, correct void refunds)
 *   - Multi-street (Hold'em) cross-street pot accumulation
 */
contract PokerEngineMultiplayerTest is Test {
    PokerEngine poker;
    LogicRegistry registry;
    MockUSDC usdc;

    address treasury = address(0x123);
    address referee  = address(0x456);
    address player1  = address(0x1);
    address player2  = address(0x2);
    address player3  = address(0x3);

    // 1-street logic (5-Card Draw) — simplest for most tests
    bytes32 constant LOGIC_ID_DRAW   = keccak256("QmDraw");
    // 4-street logic (Hold'em) — used for multi-street tests
    bytes32 constant LOGIC_ID_HOLDEM = keccak256("QmHoldem");

    // Hardcoded move/salt pairs per player for commit→reveal flows
    bytes32 constant MOVE_P1 = bytes32(uint256(1));
    bytes32 constant SALT_P1 = bytes32(uint256(111));
    bytes32 constant MOVE_P2 = bytes32(uint256(2));
    bytes32 constant SALT_P2 = bytes32(uint256(222));
    bytes32 constant MOVE_P3 = bytes32(uint256(3));
    bytes32 constant SALT_P3 = bytes32(uint256(333));

    uint256 constant STAKE      = 100 * 1e6;   // 100 USDC
    uint256 constant MAX_BUY_IN = 1000 * 1e6;  // 1000 USDC

    function setUp() public {
        usdc     = new MockUSDC();
        registry = new LogicRegistry();
        poker    = new PokerEngine(treasury, address(usdc), address(registry), referee);

        usdc.mint(player1, 10000 * 1e6);
        usdc.mint(player2, 10000 * 1e6);
        usdc.mint(player3, 10000 * 1e6);

        vm.prank(player1); usdc.approve(address(poker), type(uint256).max);
        vm.prank(player2); usdc.approve(address(poker), type(uint256).max);
        vm.prank(player3); usdc.approve(address(poker), type(uint256).max);

        // This test contract is registered as game developer — receives devRoyalty
        registry.registerLogic("QmDraw",   address(this), true, 1);
        registry.registerLogic("QmHoldem", address(this), true, 4);
        registry.setAuthorizedEscrow(address(poker), true);
    }

    // =========================================================
    // HELPERS
    // =========================================================

    /// @dev Create a 3-player 1-street match. Returns matchId.
    function _createThreePlayer(uint8 winsRequired, uint8 maxRounds)
        internal returns (uint256 matchId)
    {
        vm.prank(player1);
        poker.createMatch(STAKE, LOGIC_ID_DRAW, 3, winsRequired, maxRounds, MAX_BUY_IN, PokerEngine.BetStructure.NO_LIMIT);
        matchId = poker.matchCounter();
        vm.prank(player2); poker.joinMatch(matchId);
        vm.prank(player3); poker.joinMatch(matchId);
    }

    /// @dev Create a 3-player 4-street Hold'em match.
    function _createThreePlayerHoldem(uint8 winsRequired, uint8 maxRounds)
        internal returns (uint256 matchId)
    {
        vm.prank(player1);
        poker.createMatch(STAKE, LOGIC_ID_HOLDEM, 3, winsRequired, maxRounds, MAX_BUY_IN, PokerEngine.BetStructure.NO_LIMIT);
        matchId = poker.matchCounter();
        vm.prank(player2); poker.joinMatch(matchId);
        vm.prank(player3); poker.joinMatch(matchId);
    }

    /// @dev Commit valid hashes for all 3 players.
    function _commitAllThree(uint256 matchId) internal {
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        uint256 round = m.currentRound;

        bytes32 h1 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player1, MOVE_P1, SALT_P1));
        bytes32 h2 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player2, MOVE_P2, SALT_P2));
        bytes32 h3 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player3, MOVE_P3, SALT_P3));

        vm.prank(player1); poker.commitMove(matchId, h1);
        vm.prank(player2); poker.commitMove(matchId, h2);
        vm.prank(player3); poker.commitMove(matchId, h3);
    }

    /// @dev Commit valid hashes for only player1 and player2 (player3 skips).
    function _commitTwoOfThree(uint256 matchId) internal {
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        uint256 round = m.currentRound;

        bytes32 h1 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player1, MOVE_P1, SALT_P1));
        bytes32 h2 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player2, MOVE_P2, SALT_P2));

        vm.prank(player1); poker.commitMove(matchId, h1);
        vm.prank(player2); poker.commitMove(matchId, h2);
    }

    /// @dev All 3 players check (no bets). Transitions to REVEAL.
    function _checkAllThree(uint256 matchId) internal {
        vm.prank(player1); poker.check(matchId);
        vm.prank(player2); poker.check(matchId);
        vm.prank(player3); poker.check(matchId);
    }

    /// @dev Reveal all 3 players.
    function _revealAllThree(uint256 matchId) internal {
        vm.prank(player1); poker.revealMove(matchId, MOVE_P1, SALT_P1);
        vm.prank(player2); poker.revealMove(matchId, MOVE_P2, SALT_P2);
        vm.prank(player3); poker.revealMove(matchId, MOVE_P3, SALT_P3);
    }

    /// @dev Full round with no bets: commit → check → reveal.
    function _playRoundNoBets(uint256 matchId) internal {
        _commitAllThree(matchId);
        _checkAllThree(matchId);
        _revealAllThree(matchId);
    }

    // =========================================================
    // MATCH SETUP & PHASE TRANSITIONS
    // =========================================================

    function test_ThreePlayer_MatchActivates() public {
        uint256 matchId = _createThreePlayer(1, 3);

        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.ACTIVE));
        assertEq(m.players.length, 3);
        assertEq(m.totalPot, 3 * STAKE);

        PokerEngine.PokerState memory ps = poker.getPokerState(matchId);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.COMMIT));
        assertEq(ps.activePlayers, 3);
    }

    function test_ThreePlayer_CommitTransitionsToBet_OnlyAfterAll3() public {
        uint256 matchId = _createThreePlayer(1, 3);

        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        uint256 round = m.currentRound;
        bytes32 h1 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player1, MOVE_P1, SALT_P1));
        bytes32 h2 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player2, MOVE_P2, SALT_P2));
        bytes32 h3 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player3, MOVE_P3, SALT_P3));

        vm.prank(player1); poker.commitMove(matchId, h1);
        assertEq(uint8(poker.getPokerState(matchId).phase), uint8(PokerEngine.Phase.COMMIT)); // still COMMIT

        vm.prank(player2); poker.commitMove(matchId, h2);
        assertEq(uint8(poker.getPokerState(matchId).phase), uint8(PokerEngine.Phase.COMMIT)); // still COMMIT

        vm.prank(player3); poker.commitMove(matchId, h3);
        assertEq(uint8(poker.getPokerState(matchId).phase), uint8(PokerEngine.Phase.BET));    // now BET
        assertEq(poker.getPokerState(matchId).playersToAct, 3);
    }

    function test_ThreePlayer_AllCheck_TransitionsToReveal() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        vm.prank(player1); poker.check(matchId);
        assertEq(uint8(poker.getPokerState(matchId).phase), uint8(PokerEngine.Phase.BET));

        vm.prank(player2); poker.check(matchId);
        assertEq(uint8(poker.getPokerState(matchId).phase), uint8(PokerEngine.Phase.BET));

        vm.prank(player3); poker.check(matchId);
        assertEq(uint8(poker.getPokerState(matchId).phase), uint8(PokerEngine.Phase.REVEAL));
    }

    // =========================================================
    // TURN ORDER
    // =========================================================

    function test_ThreePlayer_TurnOrder_Sequential() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        assertEq(poker.getCurrentTurnIndex(matchId), 0); // player1 first
        vm.prank(player1); poker.check(matchId);

        assertEq(poker.getCurrentTurnIndex(matchId), 1); // player2
        vm.prank(player2); poker.check(matchId);

        assertEq(poker.getCurrentTurnIndex(matchId), 2); // player3
    }

    function test_ThreePlayer_WrongTurn_Reverts() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        vm.prank(player2); // player1's turn
        vm.expectRevert("Not your turn");
        poker.check(matchId);
    }

    function test_ThreePlayer_TurnSkipsFolded() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        // player1 raises, turn → player2
        vm.prank(player1); poker.raise(matchId, 50 * 1e6);
        assertEq(poker.getCurrentTurnIndex(matchId), 1);

        // player2 folds — turn should jump to player3
        vm.prank(player2); poker.fold(matchId);
        assertEq(poker.getCurrentTurnIndex(matchId), 2);
    }

    function test_ThreePlayer_Raise_ResetsPlayersToAct() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        vm.prank(player1); poker.raise(matchId, 50 * 1e6);

        PokerEngine.PokerState memory ps = poker.getPokerState(matchId);
        // activePlayers=3, raiser acted, so 2 others must still act
        assertEq(ps.playersToAct, 2);
        assertEq(ps.raiseCount, 1);
        assertEq(ps.currentBet, 50 * 1e6);
    }

    // =========================================================
    // FOLD WIN — ROUND POT WITH RAKE
    // =========================================================

    function test_ThreePlayer_TwoFolds_RoundPotPaidWithRake() public {
        uint256 matchId = _createThreePlayer(2, 5);

        // Simple commits (no reveal needed — fold ends the hand)
        vm.prank(player1); poker.commitMove(matchId, keccak256("h1"));
        vm.prank(player2); poker.commitMove(matchId, keccak256("h2"));
        vm.prank(player3); poker.commitMove(matchId, keccak256("h3"));

        // player1 raises 100
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 devBefore      = usdc.balanceOf(address(this));
        uint256 p1Before       = usdc.balanceOf(player1);

        // player2 and player3 fold → player1 sole winner, round pot distributed
        vm.prank(player2); poker.fold(matchId);
        vm.prank(player3); poker.fold(matchId);

        // roundPot = 100 USDC (only player1's raise; others folded at 0 bet level)
        uint256 roundPot    = 100 * 1e6;
        uint256 totalRake   = (roundPot * 750)  / 10000; // 7.5 USDC
        uint256 devRoyalty  = (roundPot * 250)  / 10000; // 2.5 USDC
        uint256 protocolRake = totalRake - devRoyalty;   // 5 USDC
        uint256 winnerShare = roundPot - totalRake;       // 92.5 USDC

        assertEq(usdc.balanceOf(treasury)      - treasuryBefore, protocolRake);
        assertEq(usdc.balanceOf(address(this)) - devBefore,      devRoyalty);
        assertEq(usdc.balanceOf(player1)       - p1Before,       winnerShare);

        // Match continues — player1 has 1 win, needs 2
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.ACTIVE));
        assertEq(m.wins[0], 1);
        assertEq(m.currentRound, 2);
    }

    function test_ThreePlayer_FoldWin_MatchSettlesWhenWinsReached() public {
        uint256 matchId = _createThreePlayer(1, 5); // 1 win needed

        vm.prank(player1); poker.commitMove(matchId, keccak256("h1"));
        vm.prank(player2); poker.commitMove(matchId, keccak256("h2"));
        vm.prank(player3); poker.commitMove(matchId, keccak256("h3"));

        vm.prank(player1); poker.raise(matchId, 50 * 1e6);

        uint256 p1Before = usdc.balanceOf(player1);
        vm.prank(player2); poker.fold(matchId);
        vm.prank(player3); poker.fold(matchId);

        // 1 win reached → _settleMatchSingleWinner (no _distributeRoundPot called)
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        // player1 contributed 100(stake)+50(raise)=150, gets back totalPot after rake
        uint256 totalPot  = 3 * STAKE + 50 * 1e6; // 350 USDC
        uint256 rake      = (totalPot * 750) / 10000;
        uint256 payout    = totalPot - rake;
        assertEq(usdc.balanceOf(player1) - p1Before, payout);
    }

    function test_ThreePlayer_FoldOneFold_TwoRemain_BettingContinues() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        // player1 raises, player2 folds — now 2 active, still in BET
        vm.prank(player1); poker.raise(matchId, 50 * 1e6);
        vm.prank(player2); poker.fold(matchId);

        PokerEngine.PokerState memory ps = poker.getPokerState(matchId);
        assertEq(ps.activePlayers, 2);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.BET));

        // player3 calls → playersToAct = 0 → REVEAL
        vm.prank(player3); poker.call(matchId);
        assertEq(uint8(poker.getPokerState(matchId).phase), uint8(PokerEngine.Phase.REVEAL));
    }

    // =========================================================
    // RAKE ON ROUND POT — MULTI-PLAYER BETTING
    // =========================================================

    function test_ThreePlayer_RoundPotRake_AllRaiseCall() public {
        uint256 matchId = _createThreePlayer(2, 5);
        _commitAllThree(matchId);

        // player1 raises 100, player2 calls, player3 calls → _currentHandPot = 300
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId); // triggers REVEAL

        _revealAllThree(matchId);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 devBefore      = usdc.balanceOf(address(this));
        uint256 p1Before       = usdc.balanceOf(player1);

        vm.prank(referee); poker.resolveRound(matchId, 0); // player1 wins

        uint256 roundPot     = 300 * 1e6;
        uint256 totalRake    = (roundPot * 750) / 10000;   // 22.5 USDC
        uint256 devRoyalty   = (roundPot * 250) / 10000;   //  7.5 USDC
        uint256 protocolRake = totalRake - devRoyalty;     // 15   USDC
        uint256 winnerShare  = roundPot - totalRake;       // 277.5 USDC

        assertEq(usdc.balanceOf(treasury)      - treasuryBefore, protocolRake);
        assertEq(usdc.balanceOf(address(this)) - devBefore,      devRoyalty);
        assertEq(usdc.balanceOf(player1)       - p1Before,       winnerShare);

        // Match continues
        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.ACTIVE));
        assertEq(poker.getMatch(matchId).currentRound, 2);
    }

    function test_ThreePlayer_NoRake_WhenHandPotIsZero() public {
        // All check means _currentHandPot = 0 — no rake event triggered mid-game
        uint256 matchId = _createThreePlayer(2, 5);
        _playRoundNoBets(matchId);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(referee); poker.resolveRound(matchId, 0);

        // No mid-game rake (roundPot = 0)
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
        assertEq(poker.getMatch(matchId).currentRound, 2);
    }

    // =========================================================
    // MULTI-ROUND: WINS TRACKING & SETTLEMENT
    // =========================================================

    function test_ThreePlayer_WinsTracking_EarlySettle() public {
        uint256 matchId = _createThreePlayer(2, 5); // need 2 wins

        // Round 1: player2 wins
        _playRoundNoBets(matchId);
        vm.prank(referee); poker.resolveRound(matchId, 1);

        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        assertEq(m.wins[1], 1);
        assertEq(m.currentRound, 2);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.ACTIVE));

        // Round 2: player2 wins again → reaches winsRequired → SETTLED
        _playRoundNoBets(matchId);
        uint256 p2Before = usdc.balanceOf(player2);
        vm.prank(referee); poker.resolveRound(matchId, 1);

        m = poker.getMatch(matchId);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(m.wins[1], 2);
        assertEq(m.winner, player2);
        assertTrue(usdc.balanceOf(player2) > p2Before);
    }

    function test_ThreePlayer_MaxRounds_TieGoesToDraw() public {
        // 3 rounds, each player wins 1 — tie → draw
        uint256 matchId = _createThreePlayer(3, 3);

        _playRoundNoBets(matchId); vm.prank(referee); poker.resolveRound(matchId, 0);
        _playRoundNoBets(matchId); vm.prank(referee); poker.resolveRound(matchId, 1);
        _playRoundNoBets(matchId); vm.prank(referee); poker.resolveRound(matchId, 2);

        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        // All have 1 win → draw settlement (no single winner stored)
        assertEq(m.winner, address(0));
    }

    function test_ThreePlayer_MaxRounds_LeaderWins() public {
        uint256 matchId = _createThreePlayer(3, 3);

        _playRoundNoBets(matchId); vm.prank(referee); poker.resolveRound(matchId, 0); // p1 wins
        _playRoundNoBets(matchId); vm.prank(referee); poker.resolveRound(matchId, 0); // p1 wins
        _playRoundNoBets(matchId); vm.prank(referee); poker.resolveRound(matchId, 1); // p2 wins

        // p1 has 2 wins, p2 has 1 → p1 wins by most wins
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, player1);
    }

    function test_ThreePlayer_DrawRound_NoMidGameDistribution() public {
        uint256 matchId = _createThreePlayer(2, 5);
        _commitAllThree(matchId);

        // Some bets placed
        vm.prank(player1); poker.raise(matchId, 60 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId);
        _revealAllThree(matchId);

        uint256 contractBefore = usdc.balanceOf(address(poker));

        // Draw (255) — pot carries forward, no mid-game distribution
        vm.prank(referee); poker.resolveRound(matchId, 255);

        // Contract balance unchanged (no payout on draw)
        assertEq(usdc.balanceOf(address(poker)), contractBefore);
        assertEq(poker.getMatch(matchId).drawCounter, 1);
        assertEq(poker.getMatch(matchId).currentRound, 2);
    }

    // =========================================================
    // RESOLVE ROUND SPLIT
    // =========================================================

    function test_ThreePlayer_ResolveRoundSplit_TwoWinners_RakeApplied() public {
        uint256 matchId = _createThreePlayer(2, 5);
        _commitAllThree(matchId);

        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId);
        _revealAllThree(matchId);

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);

        uint8[]   memory winners = new uint8[](2);   winners[0] = 0; winners[1] = 1;
        uint256[] memory splits  = new uint256[](2); splits[0]  = 5000; splits[1] = 5000;
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({ winnerIndices: winners, splitBps: splits });

        vm.prank(referee); poker.resolveRoundSplit(matchId, res);

        uint256 roundPot    = 300 * 1e6;
        uint256 totalRake   = (roundPot * 750) / 10000;
        uint256 winnerPot   = roundPot - totalRake;
        uint256 eachShare   = winnerPot / 2; // 5000 bps each, no dust here

        assertEq(usdc.balanceOf(player1) - p1Before, eachShare);
        assertEq(usdc.balanceOf(player2) - p2Before, eachShare);

        // Game continues (not last round)
        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.ACTIVE));
        assertEq(poker.getMatch(matchId).currentRound, 2);
        assertEq(poker.getMatch(matchId).drawCounter,  1);
    }

    function test_ThreePlayer_ResolveRoundSplit_LastRound_SettlesByMostWins() public {
        uint256 matchId = _createThreePlayer(2, 2);

        // Round 1: player1 wins
        _playRoundNoBets(matchId);
        vm.prank(referee); poker.resolveRound(matchId, 0);

        // Round 2 (last): split — maxRounds reached → settle by most wins
        _playRoundNoBets(matchId);

        uint8[]   memory winners = new uint8[](2);   winners[0] = 1; winners[1] = 2;
        uint256[] memory splits  = new uint256[](2); splits[0]  = 5000; splits[1] = 5000;
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({ winnerIndices: winners, splitBps: splits });

        vm.prank(referee); poker.resolveRoundSplit(matchId, res);

        // player1 has 1 win, others 0 → player1 wins match
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, player1);
    }

    function test_ResolveRoundSplit_DuplicateIndex_Reverts() public {
        uint256 matchId = _createThreePlayer(2, 5);
        _playRoundNoBets(matchId);

        uint8[]   memory winners = new uint8[](2);   winners[0] = 0; winners[1] = 0;
        uint256[] memory splits  = new uint256[](2); splits[0]  = 5000; splits[1] = 5000;
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({ winnerIndices: winners, splitBps: splits });

        vm.prank(referee); vm.expectRevert("Duplicate winner index");
        poker.resolveRoundSplit(matchId, res);
    }

    function test_ResolveRoundSplit_SplitsMismatch_Reverts() public {
        uint256 matchId = _createThreePlayer(2, 5);
        _playRoundNoBets(matchId);

        uint8[]   memory winners = new uint8[](2);   winners[0] = 0; winners[1] = 1;
        uint256[] memory splits  = new uint256[](2); splits[0]  = 5000; splits[1] = 4999;
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({ winnerIndices: winners, splitBps: splits });

        vm.prank(referee); vm.expectRevert("Splits must sum to 10000");
        poker.resolveRoundSplit(matchId, res);
    }

    function test_ResolveRoundSplit_FoldedWinner_Reverts() public {
        // Get to REVEAL with one folded player
        uint256 matchId = _createThreePlayer(2, 5);
        _commitAllThree(matchId);

        vm.prank(player1); poker.check(matchId);
        vm.prank(player2); poker.fold(matchId);   // player2 (idx 1) folds
        vm.prank(player3); poker.check(matchId);  // playersToAct → 0 → REVEAL

        vm.prank(player1); poker.revealMove(matchId, MOVE_P1, SALT_P1);
        vm.prank(player3); poker.revealMove(matchId, MOVE_P3, SALT_P3);

        uint8[]   memory winners = new uint8[](2);   winners[0] = 0; winners[1] = 1; // idx 1 folded
        uint256[] memory splits  = new uint256[](2); splits[0]  = 5000; splits[1] = 5000;
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({ winnerIndices: winners, splitBps: splits });

        vm.prank(referee); vm.expectRevert("Winner folded");
        poker.resolveRoundSplit(matchId, res);
    }

    // =========================================================
    // TIMEOUTS — MULTI-PLAYER FAIR SPLITS
    // =========================================================

    function test_ThreePlayer_CommitTimeout_SplitsAmongCommitted() public {
        uint256 matchId = _createThreePlayer(1, 3);

        // Only player1 and player2 commit; player3 does not
        _commitTwoOfThree(matchId);
        vm.warp(block.timestamp + 31 minutes);

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);
        uint256 p3Before = usdc.balanceOf(player3);

        vm.prank(player1); poker.claimTimeout(matchId);

        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.SETTLED));

        // effectivePot = 3*STAKE = 300, rake=22.5, each committed gets 138.75
        uint256 effectivePot = 3 * STAKE;
        uint256 rake         = (effectivePot * 750) / 10000;
        uint256 remaining    = effectivePot - rake;
        uint256 eachShare    = remaining / 2;

        assertEq(usdc.balanceOf(player1) - p1Before, eachShare);
        assertEq(usdc.balanceOf(player2) - p2Before, eachShare);
        assertEq(usdc.balanceOf(player3), p3Before); // nothing for the timeout player
    }

    function test_ThreePlayer_BetTimeout_SplitsNonTimedOut() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        // player1 checks → turn advances to player2; player2 times out
        vm.prank(player1); poker.check(matchId);
        assertEq(poker.getCurrentTurnIndex(matchId), 1); // player2's turn

        vm.warp(block.timestamp + 31 minutes);

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);
        uint256 p3Before = usdc.balanceOf(player3);

        vm.prank(player1); poker.claimTimeout(matchId); // player1 is not the current turn

        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.SETTLED));

        // Eligible: player1 (idx 0) and player3 (idx 2); player2 (idx 1) timed out
        uint256 effectivePot = 3 * STAKE;
        uint256 rake         = (effectivePot * 750) / 10000;
        uint256 remaining    = effectivePot - rake;
        uint256 eachShare    = remaining / 2;

        assertEq(usdc.balanceOf(player1) - p1Before, eachShare);
        assertEq(usdc.balanceOf(player2), p2Before); // timed out
        assertEq(usdc.balanceOf(player3) - p3Before, eachShare);
    }

    function test_ThreePlayer_BetTimeout_CurrentTurnCantClaim() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);

        // player2's turn (after player1 checks)
        vm.prank(player1); poker.check(matchId);
        vm.warp(block.timestamp + 31 minutes);

        vm.prank(player2); // player2 IS the current turn
        vm.expectRevert("You are the one who timed out");
        poker.claimTimeout(matchId);
    }

    function test_ThreePlayer_RevealTimeout_SplitsAmongRevealed() public {
        uint256 matchId = _createThreePlayer(1, 3);
        _commitAllThree(matchId);
        _checkAllThree(matchId);

        // player1 and player2 reveal; player3 does not
        vm.prank(player1); poker.revealMove(matchId, MOVE_P1, SALT_P1);
        vm.prank(player2); poker.revealMove(matchId, MOVE_P2, SALT_P2);
        vm.warp(block.timestamp + 31 minutes);

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);
        uint256 p3Before = usdc.balanceOf(player3);

        vm.prank(player1); poker.claimTimeout(matchId);

        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.SETTLED));

        uint256 effectivePot = 3 * STAKE;
        uint256 rake         = (effectivePot * 750) / 10000;
        uint256 remaining    = effectivePot - rake;
        uint256 eachShare    = remaining / 2;

        assertEq(usdc.balanceOf(player1) - p1Before, eachShare);
        assertEq(usdc.balanceOf(player2) - p2Before, eachShare);
        assertEq(usdc.balanceOf(player3), p3Before);
    }

    function test_ThreePlayer_CommitTimeout_OnlySingleCommitter_WinsFull() public {
        uint256 matchId = _createThreePlayer(1, 3);

        // Only player1 commits
        IBaseEscrow.BaseMatch memory m = poker.getMatch(matchId);
        uint256 round = m.currentRound;
        bytes32 h1 = keccak256(abi.encodePacked("FALKEN_V4", address(poker), matchId, round, player1, MOVE_P1, SALT_P1));
        vm.prank(player1); poker.commitMove(matchId, h1);

        vm.warp(block.timestamp + 31 minutes);

        uint256 p1Before = usdc.balanceOf(player1);
        vm.prank(player1); poker.claimTimeout(matchId);

        // commitCount == 1 → _settleMatchSingleWinner
        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        uint256 effectivePot = 3 * STAKE;
        uint256 rake         = (effectivePot * 750) / 10000;
        assertEq(usdc.balanceOf(player1) - p1Before, effectivePot - rake);
    }

    // =========================================================
    // ACCOUNTING INVARIANTS
    // =========================================================

    function test_Accounting_ContractEmptyAfterSettlement() public {
        uint256 matchId = _createThreePlayer(2, 5);

        // Round 1: bets placed, player1 wins → round pot distributed
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId);
        _revealAllThree(matchId);
        vm.prank(referee); poker.resolveRound(matchId, 0);

        // Round 2: no bets, player1 wins again → winsRequired=2 → SETTLED
        _playRoundNoBets(matchId);
        vm.prank(referee); poker.resolveRound(matchId, 0);

        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        // All USDC should have left the contract (no pending withdrawals for well-behaved addresses)
        assertEq(usdc.balanceOf(address(poker)), 0);
    }

    function test_Accounting_AdminVoid_NetRefundsAfterMidGameDistribution() public {
        uint256 matchId = _createThreePlayer(2, 5);

        // Round 1: player1 raises 100, player2 and player3 fold immediately.
        // Only player1's raise enters _currentHandPot (others folded at 0 bet level).
        // roundPot = 100 USDC. effectivePot after distribution = totalPot(400) - roundPot(100) = 300.
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        // player2 folds, player3 folds → player1 wins, round pot distributed
        vm.prank(player2); poker.fold(matchId);
        vm.prank(player3); poker.fold(matchId);
        // winsRequired=2, so match continues (round 2 starts)

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);
        uint256 p3Before = usdc.balanceOf(player3);

        poker.adminVoidMatch(matchId);

        // effectivePot = 400 - 100 = 300 USDC
        // p1: contrib=200 (stake+raise), received=winnerShare(92.5) → owed=107.5
        // p2: contrib=100 (stake only), received=0 → owed=100
        // p3: contrib=100 (stake only), received=0 → owed=100
        // totalOwed = 307.5, effectivePot = 300 → pro-rata
        uint256 roundPot    = 100 * 1e6;
        uint256 rake        = (roundPot * 750) / 10000;
        uint256 winnerShare = roundPot - rake;
        uint256 p1Owed      = (STAKE + 100 * 1e6) - winnerShare;  // 107.5e6
        uint256 p2Owed      = STAKE;                               // 100e6
        uint256 p3Owed      = STAKE;                               // 100e6
        uint256 totalOwed   = p1Owed + p2Owed + p3Owed;
        uint256 effectivePot = 300 * 1e6;

        uint256 p1Refund = (p1Owed * effectivePot) / totalOwed;
        uint256 p2Refund = (p2Owed * effectivePot) / totalOwed;
        // Last player gets the remainder (dust goes to p3)
        uint256 p3Refund = effectivePot - p1Refund - p2Refund;

        assertEq(usdc.balanceOf(player1) - p1Before, p1Refund);
        assertEq(usdc.balanceOf(player2) - p2Before, p2Refund);
        assertEq(usdc.balanceOf(player3) - p3Before, p3Refund);

        // Total refunds must equal effectivePot exactly
        assertEq(p1Refund + p2Refund + p3Refund, effectivePot);
    }

    function test_Accounting_MidGameDistributed_ReducesEffectivePot() public {
        uint256 matchId = _createThreePlayer(2, 5);

        // Round 1 with 300 USDC in bets, player1 wins → 300 distributed (less rake)
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId);
        _revealAllThree(matchId);
        vm.prank(referee); poker.resolveRound(matchId, 0);

        // Round 2 also has bets; player1 wins again (winsRequired)
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 50 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId);
        _revealAllThree(matchId);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(referee); poker.resolveRound(matchId, 0); // triggers _settleMatchSingleWinner

        // effectivePot = totalPot - _midGameDistributed
        // totalPot = 300(stakes) + 300(round1 bets) + 150(round2 bets) = 750
        // _midGameDistributed = 300 (full round1 pot including rake — already paid out)
        // effectivePot = 450
        // rake on 450 = 450 * 750 / 10000 = 33.75 USDC protocol+dev
        uint256 effectivePot = 450 * 1e6;
        uint256 finalRake    = (effectivePot * 750)  / 10000;
        uint256 finalDev     = (effectivePot * 250)  / 10000;
        uint256 finalProtocol = finalRake - finalDev;

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, finalProtocol);
    }

    // =========================================================
    // MULTI-STREET (HOLD'EM)
    // =========================================================

    function test_Holdem_AdvanceStreet_ResetsState() public {
        uint256 matchId = _createThreePlayerHoldem(2, 5);

        // Street 0: commit, check, reveal
        _commitAllThree(matchId);
        _checkAllThree(matchId);
        _revealAllThree(matchId);

        vm.prank(referee); poker.advanceStreet(matchId);

        PokerEngine.PokerState memory ps = poker.getPokerState(matchId);
        assertEq(ps.street, 1);
        assertEq(uint8(ps.phase), uint8(PokerEngine.Phase.COMMIT));
        assertEq(ps.currentBet, 0);
        assertEq(ps.raiseCount, 0);
    }

    function test_Holdem_CrossStreetPotAccumulates() public {
        uint256 matchId = _createThreePlayerHoldem(2, 5);

        // Street 0: each player bets 50 → _currentHandPot = 150
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 50 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId);
        _revealAllThree(matchId);
        vm.prank(referee); poker.advanceStreet(matchId);

        // Street 1: each player bets 100 → _currentHandPot += 300 = 450
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        vm.prank(player2); poker.call(matchId);
        vm.prank(player3); poker.call(matchId);
        _revealAllThree(matchId);
        vm.prank(referee); poker.advanceStreet(matchId);

        // Streets 2 and 3: no bets
        _commitAllThree(matchId); _checkAllThree(matchId); _revealAllThree(matchId);
        vm.prank(referee); poker.advanceStreet(matchId);
        _commitAllThree(matchId); _checkAllThree(matchId); _revealAllThree(matchId);

        // Final street resolve: roundPot = 450 USDC
        uint256 roundPot    = 450 * 1e6;
        uint256 totalRake   = (roundPot * 750) / 10000;
        uint256 winnerShare = roundPot - totalRake;
        uint256 p1Before    = usdc.balanceOf(player1);

        vm.prank(referee); poker.resolveRound(matchId, 0);

        assertEq(usdc.balanceOf(player1) - p1Before, winnerShare);
    }

    function test_Holdem_AdvanceStreet_NotOnLastStreet_Reverts() public {
        uint256 matchId = _createThreePlayerHoldem(2, 5);

        // Advance all the way to the last street (street 3 of 4)
        for (uint8 s = 0; s < 3; s++) {
            _commitAllThree(matchId); _checkAllThree(matchId); _revealAllThree(matchId);
            vm.prank(referee); poker.advanceStreet(matchId);
        }
        // Now on street 3 (last) — cannot advance further
        _commitAllThree(matchId); _checkAllThree(matchId); _revealAllThree(matchId);

        vm.prank(referee); vm.expectRevert("Already on last street");
        poker.advanceStreet(matchId);
    }

    // =========================================================
    // #1: MUTUAL TIMEOUT WITH MID-GAME DISTRIBUTION
    // =========================================================

    function test_MutualTimeout_WithMidGameDistribution() public {
        // winsRequired=2 so a fold-win in round 1 continues the match
        uint256 matchId = _createThreePlayer(2, 5);

        // Round 1: player1 raises 100, player2+3 fold → round pot distributed mid-game.
        // After: totalPot=400, _midGameDistributed=100, effectivePot=300
        // playerContributions: p1=200, p2=100, p3=100
        // _midGameReceived[p1] = winnerShare (92.5 USDC)
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        vm.prank(player2); poker.fold(matchId);
        vm.prank(player3); poker.fold(matchId);
        // Match continues (round 2 started, winsRequired=2)

        uint256 p1Before       = usdc.balanceOf(player1);
        uint256 p2Before       = usdc.balanceOf(player2);
        uint256 p3Before       = usdc.balanceOf(player3);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(player2); poker.mutualTimeout(matchId);

        assertEq(uint8(poker.getMatch(matchId).status), uint8(IBaseEscrow.MatchStatus.VOIDED));

        // Compute expected refunds with pro-rata + 1% penalty:
        uint256 roundPot    = 100 * 1e6;
        uint256 rake        = (roundPot * 750) / 10000;
        uint256 winnerShare = roundPot - rake;
        uint256 p1Owed      = (STAKE + 100 * 1e6) - winnerShare;  // 107_500_000
        uint256 p2Owed      = STAKE;
        uint256 p3Owed      = STAKE;
        uint256 totalOwed   = p1Owed + p2Owed + p3Owed;
        uint256 effPot      = 300 * 1e6;

        uint256 p1ProRata = (p1Owed * effPot) / totalOwed;
        uint256 p2ProRata = (p2Owed * effPot) / totalOwed;
        uint256 p3ProRata = effPot - p1ProRata - p2ProRata; // remainder to last player

        uint256 p1Penalty = (p1ProRata * 100) / 10000;
        uint256 p2Penalty = (p2ProRata * 100) / 10000;
        uint256 p3Penalty = (p3ProRata * 100) / 10000;

        uint256 p1Refund = p1ProRata - p1Penalty;
        uint256 p2Refund = p2ProRata - p2Penalty;
        uint256 p3Refund = p3ProRata - p3Penalty;

        uint256 totalPenalty = p1Penalty + p2Penalty + p3Penalty;

        assertEq(usdc.balanceOf(player1) - p1Before, p1Refund);
        assertEq(usdc.balanceOf(player2) - p2Before, p2Refund);
        assertEq(usdc.balanceOf(player3) - p3Before, p3Refund);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, totalPenalty);

        // Contract drained to zero
        assertEq(usdc.balanceOf(address(poker)), 0);
    }

    // =========================================================
    // #2: POT_LIMIT FORMULA IN ROUND 2 WITH _midGameDistributed > 0
    // =========================================================

    function test_PotLimit_Round2_ReducedByMidGameDistribution() public {
        // Create POT_LIMIT 3-player match
        vm.prank(player1);
        poker.createMatch(STAKE, LOGIC_ID_DRAW, 3, 2, 5, MAX_BUY_IN, PokerEngine.BetStructure.POT_LIMIT);
        uint256 matchId = poker.matchCounter();
        vm.prank(player2); poker.joinMatch(matchId);
        vm.prank(player3); poker.joinMatch(matchId);

        // Round 1: player1 raises 100, player2+3 fold → mid-game distribution.
        // After: totalPot=400, _midGameDistributed=100, effectivePot=300
        _commitAllThree(matchId);
        vm.prank(player1); poker.raise(matchId, 100 * 1e6);
        vm.prank(player2); poker.fold(matchId);
        vm.prank(player3); poker.fold(matchId);

        // Round 2: potLimit = (totalPot - _midGameDistributed) + _currentHandPot
        //                   = (400 - 100) + 0 = 300 USDC
        _commitAllThree(matchId);

        // Raise of 301 exceeds pot limit → should revert
        vm.prank(player1);
        vm.expectRevert("Pot limit exceeded");
        poker.raise(matchId, 301 * 1e6);

        // Raise of exactly 300 is at the pot limit → should succeed
        vm.prank(player1); poker.raise(matchId, 300 * 1e6);
        assertEq(poker.getPokerState(matchId).currentBet, 300 * 1e6);
        assertEq(poker.getPokerState(matchId).raiseCount, 1);
    }

    // =========================================================
    // #5: RESOLVE ROUND SPLIT REVERTS ON NON-FINAL STREET
    // =========================================================

    function test_ResolveRoundSplit_NonFinalStreet_Reverts() public {
        // Hold'em has 4 streets (0-3); final street = 3.
        uint256 matchId = _createThreePlayerHoldem(2, 5);

        // Complete street 0 (non-final): all reveal
        _commitAllThree(matchId);
        _checkAllThree(matchId);
        _revealAllThree(matchId);
        // street = 0, maxStreets = 4 → not final street

        uint8[]   memory winners = new uint8[](2);   winners[0] = 0; winners[1] = 1;
        uint256[] memory splits  = new uint256[](2); splits[0]  = 5000; splits[1] = 5000;
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({ winnerIndices: winners, splitBps: splits });

        vm.prank(referee);
        vm.expectRevert("Not on final street");
        poker.resolveRoundSplit(matchId, res);
    }

    // =========================================================
    // #6: REVEAL ORDER INDEPENDENCE
    // =========================================================

    function test_RevealOrder_Independence() public {
        // Match A: reveal order p1 → p2 → p3
        uint256 matchA = _createThreePlayer(1, 3);
        _commitAllThree(matchA);
        _checkAllThree(matchA);
        vm.prank(player1); poker.revealMove(matchA, MOVE_P1, SALT_P1);
        vm.prank(player2); poker.revealMove(matchA, MOVE_P2, SALT_P2);
        vm.prank(player3); poker.revealMove(matchA, MOVE_P3, SALT_P3);

        uint256 p1BeforeA = usdc.balanceOf(player1);
        vm.prank(referee); poker.resolveRound(matchA, 0); // player1 wins
        uint256 payoutA = usdc.balanceOf(player1) - p1BeforeA;

        // Match B: reveal order p3 → p1 → p2
        uint256 matchB = _createThreePlayer(1, 3);
        _commitAllThree(matchB);
        _checkAllThree(matchB);
        vm.prank(player3); poker.revealMove(matchB, MOVE_P3, SALT_P3);
        vm.prank(player1); poker.revealMove(matchB, MOVE_P1, SALT_P1);
        vm.prank(player2); poker.revealMove(matchB, MOVE_P2, SALT_P2);

        uint256 p1BeforeB = usdc.balanceOf(player1);
        vm.prank(referee); poker.resolveRound(matchB, 0); // player1 wins
        uint256 payoutB = usdc.balanceOf(player1) - p1BeforeB;

        // Payout is identical regardless of reveal order
        assertEq(payoutA, payoutB);
        assertEq(uint8(poker.getMatch(matchA).status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(uint8(poker.getMatch(matchB).status), uint8(IBaseEscrow.MatchStatus.SETTLED));
    }
}
