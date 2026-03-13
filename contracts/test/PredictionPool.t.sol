// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../src/core/PredictionPool.sol";
import "../src/core/BaseEscrow.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/BlocklistMockUSDC.sol";

// Mock escrow that inherits BaseEscrow for testing match-linked pools
contract MockEscrowForPredictionPool is BaseEscrow {
    using SafeERC20 for IERC20;
    
    constructor(address treasury, address usdc) BaseEscrow(treasury, usdc) {}

    function createMatch(
        uint256 stake,
        bytes32 logicId,
        uint8 maxPlayers,
        uint8 winsRequired,
        uint8 maxRounds
    ) external nonReentrant whenNotPaused {
        _initMatch(stake, logicId, maxPlayers, winsRequired, maxRounds);
    }

    function joinMatchExternal(uint256 matchId) external nonReentrant whenNotPaused {
        // Pull USDC stake from caller and join the match
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

    function settleMatch(uint256 matchId, uint8 winnerIndex) external onlyOwner {
        _settleMatchSingleWinner(matchId, winnerIndex);
    }

    function settleMatchDraw(uint256 matchId) external onlyOwner {
        _settleMatchDraw(matchId);
    }

    function _claimTimeout(uint256 matchId) internal override {
        uint8 winnerIndex = uint8(_findPlayerIndex(matchId, msg.sender));
        _settleMatchSingleWinner(matchId, winnerIndex);
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

    function _onMatchActivated(uint256 matchId) internal override {}
}

contract PredictionPoolTest is Test {
    PredictionPool pool;
    MockEscrowForPredictionPool escrow;
    MockUSDC usdc;
    
    address treasury = address(0x123);
    address owner = address(this);
    address bettor1 = address(0x456);
    address bettor2 = address(0x789);
    address bettor3 = address(0xabc);
    address player1 = address(0xdef);
    address player2 = address(0xfed);

    uint256 constant INITIAL_BALANCE = 10000 * 1e6; // 10,000 USDC
    bytes32 constant LOGIC_ID = keccak256("test-game");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new MockEscrowForPredictionPool(treasury, address(usdc));
        pool = new PredictionPool(treasury, address(usdc));

        // Fund all accounts
        usdc.mint(bettor1, INITIAL_BALANCE);
        usdc.mint(bettor2, INITIAL_BALANCE);
        usdc.mint(bettor3, INITIAL_BALANCE);
        usdc.mint(player1, INITIAL_BALANCE);
        usdc.mint(player2, INITIAL_BALANCE);

        // Approve pool for all bettors
        vm.prank(bettor1);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bettor2);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bettor3);
        usdc.approve(address(pool), type(uint256).max);

        // Approve escrow for players
        vm.prank(player1);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(player2);
        usdc.approve(address(escrow), type(uint256).max);

        // Authorize escrow
        pool.setAuthorizedEscrow(address(escrow), true);
    }

    // ==================== CONSTRUCTOR TESTS ====================

    function test_Constructor() public view {
        assertEq(pool.treasury(), treasury);
        assertEq(address(pool.usdc()), address(usdc));
        assertEq(pool.RAKE_BPS(), 750);
        assertEq(pool.MIN_BET(), 100_000);
        assertEq(pool.poolCounter(), 0);
    }

    function test_Constructor_ZeroTreasury() public {
        vm.expectRevert("Invalid treasury");
        new PredictionPool(address(0), address(usdc));
    }

    function test_Constructor_ZeroUSDC() public {
        vm.expectRevert("Invalid USDC");
        new PredictionPool(treasury, address(0));
    }

    // ==================== POOL CREATION TESTS ====================

    function test_CreatePool_MatchLinked() public {
        uint256 deadline = block.timestamp + 1 hours;
        string[] memory outcomes = new string[](3);
        outcomes[0] = "Player A";
        outcomes[1] = "Player B";
        outcomes[2] = "Draw";

        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            deadline,
            "Who will win?",
            outcomes
        );

        assertEq(poolId, 1);
        assertEq(pool.poolCounter(), 1);

        PredictionPool.Pool memory p = pool.getPool(1);
        assertEq(p.escrowAddress, address(escrow));
        assertEq(p.matchId, 1);
        assertEq(p.bettingDeadline, deadline);
        assertEq(p.title, "Who will win?");
        assertEq(p.outcomeLabels.length, 3);
        assertEq(p.outcomeLabels[0], "Player A");
        assertEq(p.totalPool, 0);
        assertEq(p.resolved, false);
        assertEq(p.outcomeTotals.length, 3);
    }

    function test_CreatePool_Standalone() public {
        uint256 deadline = block.timestamp + 1 hours;
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        uint256 poolId = pool.createPool(
            address(0),
            0,
            deadline,
            "Will ETH reach $5000?",
            outcomes
        );

        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertEq(p.escrowAddress, address(0));
        assertEq(p.matchId, 0);
        assertEq(p.title, "Will ETH reach $5000?");
    }

    function test_CreatePool_PastDeadline() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        vm.expectRevert("Deadline must be in future");
        pool.createPool(address(0), 0, block.timestamp - 1, "Test", outcomes);
    }

    function test_CreatePool_TooFewOutcomes() public {
        string[] memory outcomes = new string[](1);
        outcomes[0] = "Yes";

        vm.expectRevert("Need at least 2 outcomes");
        pool.createPool(address(0), 0, block.timestamp + 1 hours, "Test", outcomes);
    }

    function test_CreatePool_TooManyOutcomes() public {
        string[] memory outcomes = new string[](11);
        for (uint i = 0; i < 11; i++) {
            outcomes[i] = "Option";
        }

        vm.expectRevert("Too many outcomes");
        pool.createPool(address(0), 0, block.timestamp + 1 hours, "Test", outcomes);
    }

    function test_CreatePool_EmptyTitle() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        vm.expectRevert("Title required");
        pool.createPool(address(0), 0, block.timestamp + 1 hours, "", outcomes);
    }

    function test_CreatePool_LongTitle() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        string memory longTitle = new string(201);

        vm.expectRevert("Title too long");
        pool.createPool(address(0), 0, block.timestamp + 1 hours, longTitle, outcomes);
    }

    function test_CreatePool_UnauthorizedEscrow() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        vm.expectRevert("Escrow not authorized");
        pool.createPool(address(0x999), 1, block.timestamp + 1 hours, "Test", outcomes);
    }

    function test_CreatePool_ZeroMatchId() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        vm.expectRevert("Invalid match ID");
        pool.createPool(address(escrow), 0, block.timestamp + 1 hours, "Test", outcomes);
    }

    function test_CreatePool_OnlyOwner() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        vm.prank(bettor1);
        vm.expectRevert();
        pool.createPool(address(0), 0, block.timestamp + 1 hours, "Test", outcomes);
    }

    function test_CreatePool_Event() public {
        uint256 deadline = block.timestamp + 1 hours;
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";

        vm.expectEmit(true, true, true, true);
        emit PredictionPool.PoolCreated(1, address(escrow), 1, deadline, "Test", outcomes);

        pool.createPool(address(escrow), 1, deadline, "Test", outcomes);
    }

    // ==================== PLACE BET TESTS ====================

    function test_PlaceBet() public {
        // Create pool
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // Place bet
        uint256 betAmount = 100 * 1e6; // 100 USDC
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, betAmount);

        // Verify state
        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertEq(p.totalPool, betAmount);
        assertEq(p.outcomeTotals[0], betAmount);
        assertEq(p.outcomeTotals[1], 0);
        assertEq(pool.getBet(poolId, bettor1, 0), betAmount);
        assertEq(usdc.balanceOf(bettor1), INITIAL_BALANCE - betAmount);
        assertEq(usdc.balanceOf(address(pool)), betAmount);
    }

    function test_PlaceBet_MultipleBettors() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // Bettor 1 bets on Yes
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        // Bettor 2 bets on No
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        // Bettor 3 also bets on Yes
        vm.prank(bettor3);
        pool.placeBet(poolId, 0, 300 * 1e6);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertEq(p.totalPool, 600 * 1e6);
        assertEq(p.outcomeTotals[0], 400 * 1e6);
        assertEq(p.outcomeTotals[1], 200 * 1e6);
    }

    function test_PlaceBet_MultipleBetsSameOutcome() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 200 * 1e6);

        assertEq(pool.getBet(poolId, bettor1, 0), 300 * 1e6);
    }

    function test_PlaceBet_BelowMinimum() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        vm.expectRevert("Bet below minimum");
        pool.placeBet(poolId, 0, 0.05 * 1e6); // 0.05 USDC < MIN_BET
    }

    function test_PlaceBet_InvalidOutcome() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        vm.expectRevert("Invalid outcome");
        pool.placeBet(poolId, 2, 100 * 1e6);
    }

    function test_PlaceBet_AfterDeadline() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // Warp past deadline
        vm.warp(block.timestamp + 2 hours);

        vm.prank(bettor1);
        vm.expectRevert("Betting closed");
        pool.placeBet(poolId, 0, 100 * 1e6);
    }

    function test_PlaceBet_AfterResolved() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        // Warp and resolve
        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        vm.prank(bettor2);
        vm.expectRevert("Pool already resolved");
        pool.placeBet(poolId, 0, 100 * 1e6);
    }

    function test_PlaceBet_PoolNotExist() public {
        vm.prank(bettor1);
        vm.expectRevert("Pool does not exist");
        pool.placeBet(999, 0, 100 * 1e6);
    }

    function test_PlaceBet_WhenPaused() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        pool.pause();

        vm.prank(bettor1);
        vm.expectRevert();
        pool.placeBet(poolId, 0, 100 * 1e6);
    }

    function test_PlaceBet_Event() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.expectEmit(true, true, false, true);
        emit PredictionPool.BetPlaced(poolId, bettor1, 0, 100 * 1e6);

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);
    }

    // ==================== RESOLVE POOL (MATCH-LINKED) TESTS ====================

    function test_ResolvePool_MatchLinked() public {
        // Setup: Create and settle a match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        escrow.joinMatchExternal(1);

        // Create pool
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Player A";
        outcomes[1] = "Player B";
        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            block.timestamp + 1 hours,
            "Who wins?",
            outcomes
        );

        // Place bets
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6); // Bet on player1
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6); // Bet on player2

        // Settle match (player1 wins)
        escrow.settleMatch(1, 0);

        // Warp past deadline
        vm.warp(block.timestamp + 2 hours);

        // Resolve pool
        pool.resolvePool(poolId);

        // Verify
        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertEq(p.resolved, true);
        assertEq(p.winningOutcome, 0);
        assertEq(p.isDraw, false);
    }

    function test_ResolvePool_MatchNotSettled() public {
        // Create match but don't settle
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);

        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert("Match not settled yet");
        pool.resolvePool(poolId);
    }

    function test_ResolvePool_BettingStillOpen() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.expectRevert("Betting still open");
        pool.resolvePool(poolId);
    }

    function test_ResolvePool_NotMatchLinked() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert("Not a match-linked pool");
        pool.resolvePool(poolId);
    }

    function test_ResolvePool_AlreadyResolved() public {
        // Setup match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        vm.prank(player2);
        escrow.joinMatchExternal(1);

        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        escrow.settleMatch(1, 0);
        vm.warp(block.timestamp + 2 hours);
        pool.resolvePool(poolId);

        vm.expectRevert("Pool already resolved");
        pool.resolvePool(poolId);
    }

    // ==================== RESOLVE POOL MANUAL TESTS ====================

    function test_ResolvePoolManual() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);

        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);

        pool.resolvePoolManual(poolId, 0);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertEq(p.resolved, true);
        assertEq(p.winningOutcome, 0);

        // Check rake was transferred
        uint256 expectedRake = (100 * 1e6 * 750) / 10000; // 7.5 USDC
        assertEq(usdc.balanceOf(treasury) - treasuryBalanceBefore, expectedRake);
    }

    function test_ResolvePoolManual_OnlyOwner() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.warp(block.timestamp + 2 hours);

        vm.prank(bettor1);
        vm.expectRevert();
        pool.resolvePoolManual(poolId, 0);
    }

    function test_ResolvePoolManual_InvalidOutcome() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert("Invalid outcome");
        pool.resolvePoolManual(poolId, 2);
    }

    // ==================== RESOLVE POOL DRAW TESTS ====================

    function test_ResolvePoolDraw() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);

        pool.resolvePoolDraw(poolId);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertEq(p.resolved, true);
        assertEq(p.isDraw, true);
    }

    function test_ResolvePoolDraw_OnlyOwner() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.warp(block.timestamp + 2 hours);

        vm.prank(bettor1);
        vm.expectRevert();
        pool.resolvePoolDraw(poolId);
    }

    // ==================== CLAIM WINNINGS TESTS ====================

    function test_ClaimWinnings_Winner() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // Bettor1 bets 100 on Yes
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        // Bettor2 bets 100 on No
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0); // Yes wins

        uint256 balanceBefore = usdc.balanceOf(bettor1);

        // Bettor1 claims
        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        // Winner gets: (100 / 100) * (200 * 0.925) = 185 USDC
        uint256 expectedPayout = 185 * 1e6;
        assertEq(usdc.balanceOf(bettor1) - balanceBefore, expectedPayout);
    }

    function test_ClaimWinnings_Proportional() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // Bettor1 bets 100 on Yes
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        // Bettor2 bets 200 on Yes (same outcome)
        vm.prank(bettor2);
        pool.placeBet(poolId, 0, 200 * 1e6);

        // Bettor3 bets 100 on No
        vm.prank(bettor3);
        pool.placeBet(poolId, 1, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0); // Yes wins

        uint256 rake = (400 * 1e6 * 750) / 10000; // 30 USDC
        uint256 remainingPool = 400 * 1e6 - rake; // 370 USDC
        uint256 winningTotal = 300 * 1e6;

        // Bettor1 should get: (100 / 300) * 380 = 126.666... USDC
        uint256 bettor1Expected = (100 * 1e6 * remainingPool) / winningTotal;

        uint256 balanceBefore = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor1) - balanceBefore, bettor1Expected);

        // Bettor2 should get: (200 / 300) * 380 = 253.333... USDC
        uint256 bettor2Expected = (200 * 1e6 * remainingPool) / winningTotal;

        balanceBefore = usdc.balanceOf(bettor2);
        vm.prank(bettor2);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor2) - balanceBefore, bettor2Expected);
    }

    function test_ClaimWinnings_LoserGetsNothing() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0); // Yes wins

        // Loser tries to claim
        vm.prank(bettor2);
        vm.expectRevert("No winning bets");
        pool.claimWinnings(poolId);
    }

    function test_ClaimWinnings_Draw() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolDraw(poolId);

        // Both get full refund
        uint256 balanceBefore = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor1) - balanceBefore, 100 * 1e6);

        balanceBefore = usdc.balanceOf(bettor2);
        vm.prank(bettor2);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor2) - balanceBefore, 200 * 1e6);
    }

    function test_ClaimWinnings_NotResolved() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.prank(bettor1);
        vm.expectRevert("Pool not resolved");
        pool.claimWinnings(poolId);
    }

    function test_ClaimWinnings_AlreadyClaimed() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        vm.prank(bettor1);
        vm.expectRevert("Already claimed");
        pool.claimWinnings(poolId);
    }

    function test_ClaimWinnings_NoBets() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        // Bettor2 never bet, tries to claim
        vm.prank(bettor2);
        vm.expectRevert("No winning bets");
        pool.claimWinnings(poolId);
    }

    function test_ClaimWinnings_Event() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        vm.expectEmit(true, true, false, false);
        emit PredictionPool.WinningsClaimed(poolId, bettor1, 185 * 1e6);

        vm.prank(bettor1);
        pool.claimWinnings(poolId);
    }

    // ==================== AUTHORIZED ESCROW TESTS ====================

    function test_SetAuthorizedEscrow() public {
        address newEscrow = address(0x999);
        pool.setAuthorizedEscrow(newEscrow, true);
        assertEq(pool.authorizedEscrows(newEscrow), true);
    }

    function test_SetAuthorizedEscrow_Deauthorize() public {
        pool.setAuthorizedEscrow(address(escrow), false);
        assertEq(pool.authorizedEscrows(address(escrow)), false);
    }

    function test_SetAuthorizedEscrow_ZeroAddress() public {
        vm.expectRevert("Invalid escrow");
        pool.setAuthorizedEscrow(address(0), true);
    }

    function test_SetAuthorizedEscrow_OnlyOwner() public {
        vm.prank(bettor1);
        vm.expectRevert();
        pool.setAuthorizedEscrow(address(0x999), true);
    }

    function test_SetAuthorizedEscrow_Event() public {
        address newEscrow = address(0x999);

        vm.expectEmit(true, false, false, false);
        emit PredictionPool.EscrowAuthorized(newEscrow);

        pool.setAuthorizedEscrow(newEscrow, true);
    }

    function test_EscrowDeauthorized_Event() public {
        vm.expectEmit(true, false, false, false);
        emit PredictionPool.EscrowDeauthorized(address(escrow));

        pool.setAuthorizedEscrow(address(escrow), false);
    }

    // ==================== TREASURY TESTS ====================

    function test_SetTreasury() public {
        address newTreasury = address(0x999);
        pool.setTreasury(newTreasury);
        assertEq(pool.treasury(), newTreasury);
    }

    function test_SetTreasury_ZeroAddress() public {
        vm.expectRevert("Invalid treasury");
        pool.setTreasury(address(0));
    }

    function test_SetTreasury_OnlyOwner() public {
        vm.prank(bettor1);
        vm.expectRevert();
        pool.setTreasury(address(0x999));
    }

    function test_SetTreasury_Event() public {
        address newTreasury = address(0x999);

        vm.expectEmit(true, true, false, false);
        emit PredictionPool.TreasuryUpdated(treasury, newTreasury);

        pool.setTreasury(newTreasury);
    }

    // ==================== PAUSE TESTS ====================

    function test_Pause() public {
        pool.pause();
        assertEq(pool.paused(), true);
    }

    function test_Unpause() public {
        pool.pause();
        pool.unpause();
        assertEq(pool.paused(), false);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(bettor1);
        vm.expectRevert();
        pool.pause();
    }

    function test_Unpause_OnlyOwner() public {
        pool.pause();
        vm.prank(bettor1);
        vm.expectRevert();
        pool.unpause();
    }

    // ==================== EMERGENCY REFUND TESTS ====================

    function test_EmergencyRefund() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        uint256 balanceBefore = usdc.balanceOf(bettor1);

        pool.emergencyRefund(poolId, bettor1, 0);

        assertEq(usdc.balanceOf(bettor1) - balanceBefore, 100 * 1e6);
        assertEq(pool.getBet(poolId, bettor1, 0), 0);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertEq(p.totalPool, 0);
        assertEq(p.outcomeTotals[0], 0);
    }

    function test_EmergencyRefund_OnlyOwner() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.prank(bettor2);
        vm.expectRevert();
        pool.emergencyRefund(poolId, bettor1, 0);
    }

    function test_EmergencyRefund_PoolResolved() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        vm.expectRevert("Pool already resolved");
        pool.emergencyRefund(poolId, bettor1, 0);
    }

    function test_EmergencyRefund_NoBet() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.expectRevert("No bet to refund");
        pool.emergencyRefund(poolId, bettor1, 0);
    }

    // ==================== VIEW FUNCTION TESTS ====================

    function test_GetBet() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        assertEq(pool.getBet(poolId, bettor1, 0), 100 * 1e6);
        assertEq(pool.getBet(poolId, bettor1, 1), 0);
    }

    function test_GetBets() public {
        string[] memory outcomes = new string[](3);
        outcomes[0] = "A";
        outcomes[1] = "B";
        outcomes[2] = "C";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);
        vm.prank(bettor1);
        pool.placeBet(poolId, 1, 200 * 1e6);

        uint256[] memory betAmounts = pool.getBets(poolId, bettor1);
        assertEq(betAmounts.length, 3);
        assertEq(betAmounts[0], 100 * 1e6);
        assertEq(betAmounts[1], 200 * 1e6);
        assertEq(betAmounts[2], 0);
    }

    function test_CalculatePayout() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.prank(bettor2);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.prank(bettor3);
        pool.placeBet(poolId, 1, 100 * 1e6);

        // Total: 300, winningTotal: 200, rake: 22.5, remaining: 277.5
        // bettor1 payout: (100/200) * 277.5 = 138.75 USDC
        uint256 expectedPayout = (100 * 1e6 * 277_500_000) / (200 * 1e6);
        assertEq(pool.calculatePayout(poolId, bettor1, 0), expectedPayout);
    }

    function test_CalculatePayout_NoBet() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        assertEq(pool.calculatePayout(poolId, bettor2, 0), 0);
    }

    function test_CalculatePayout_InvalidOutcome() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.expectRevert("Invalid outcome");
        pool.calculatePayout(poolId, bettor1, 2);
    }

    function test_GetOdds() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // No bets yet
        assertEq(pool.getOdds(poolId, 0), 0);

        // Equal bets on both
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 100 * 1e6);

        // Equal distribution: totalPool/outcomeTotal = 200/100 = 2.0x = 20000 bps
        assertEq(pool.getOdds(poolId, 0), 20000);
        assertEq(pool.getOdds(poolId, 1), 20000);
    }

    function test_GetOdds_Uneven() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // 2:1 ratio
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 200 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 100 * 1e6);

        // Outcome 0 has 200, total is 300: odds = (300 * 10000) / 200 = 15000 (1.5x)
        assertEq(pool.getOdds(poolId, 0), 15000);

        // Outcome 1 has 100, total is 300: odds = (300 * 10000) / 100 = 30000 (3.0x)
        assertEq(pool.getOdds(poolId, 1), 30000);
    }

    function test_GetOdds_InvalidOutcome() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.expectRevert("Invalid outcome");
        pool.getOdds(poolId, 2);
    }

    // ==================== EDGE CASE TESTS ====================

    function test_EmptyPoolResolution() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        vm.warp(block.timestamp + 2 hours);

        // Resolve with no bets - should work but no rake
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        pool.resolvePoolManual(poolId, 0);

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 0);
    }

    function test_SingleBettorWins() public {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Yes";
        outcomes[1] = "No";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // Only one bettor on winning outcome
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        uint256 balanceBefore = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        // Gets entire pool minus rake: 100 - 7.5 = 92.5
        assertEq(usdc.balanceOf(bettor1) - balanceBefore, 92_500_000);
    }

    function test_MultipleBetsDifferentOutcomes() public {
        string[] memory outcomes = new string[](3);
        outcomes[0] = "A";
        outcomes[1] = "B";
        outcomes[2] = "C";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Test",
            outcomes
        );

        // Bettor 1 bets on A and B
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 50 * 1e6);
        vm.prank(bettor1);
        pool.placeBet(poolId, 1, 50 * 1e6);

        // Bettor 2 bets on B
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 1); // B wins

        // Bettor1 gets payout only for their B bet (50)
        uint256 balanceBefore = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        // Total pool: 200, winning total: 150, rake: 15, remaining: 185
        // bettor1 B payout: (50/150) * 185 = 61.666...
        uint256 expectedPayout = uint256(50 * 1e6) * uint256(185 * 1e6) / uint256(150 * 1e6);
        assertEq(usdc.balanceOf(bettor1) - balanceBefore, expectedPayout);
    }

    function test_PoolNotExist_Views() public view {
        // getPool returns an empty Pool struct for non-existent pools (no revert)
        PredictionPool.Pool memory p = pool.getPool(999);
        assertEq(p.escrowAddress, address(0));
        assertEq(p.totalPool, 0);
    }

    // ==================== RECEIVE FALLBACK TEST ====================

    function test_ReceiveEthReverts() public {
        vm.expectRevert("ETH not accepted");
        (bool success,) = address(pool).call{value: 1 ether}("");
        // Note: The expectRevert will catch the revert, success will be false
        // This test verifies the revert message is correct
        // Silence unused variable warning
        (success);
    }

    // ==================== INTEGRATION TESTS ====================

    function test_FullFlow_MatchLinked() public {
        // 1. Create and join match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        vm.prank(player2);
        escrow.joinMatchExternal(1);

        // 2. Create pool
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Player A";
        outcomes[1] = "Player B";
        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            block.timestamp + 1 hours,
            "Who wins?",
            outcomes
        );

        // 3. Place bets
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        // 4. Settle match (player 1 wins)
        escrow.settleMatch(1, 0);

        // 5. Warp past deadline
        vm.warp(block.timestamp + 2 hours);

        // 6. Resolve pool
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        pool.resolvePool(poolId);

        // Verify rake transferred
        uint256 totalPool = 300 * 1e6;
        uint256 expectedRake = (totalPool * 750) / 10000; // 22.5 USDC
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, expectedRake);

        // 7. Bettor 1 claims winnings
        uint256 bettor1BalanceBefore = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        // Winning total is 100, bettor1 gets entire winning pool after rake
        // payout = (100 / 100) * (300 - 22.5) = 277.5 USDC
        assertEq(usdc.balanceOf(bettor1) - bettor1BalanceBefore, 277_500_000);
    }

    function test_FullFlow_Standalone() public {
        // 1. Create standalone pool
        string[] memory outcomes = new string[](3);
        outcomes[0] = "Joshua";
        outcomes[1] = "David";
        outcomes[2] = "Draw";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Who wins the chess match?",
            outcomes
        );

        // 2. Multiple bettors place bets
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 500 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 0, 500 * 1e6);
        vm.prank(bettor3);
        pool.placeBet(poolId, 1, 1000 * 1e6);

        // 3. Warp and resolve manually
        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0); // Joshua wins

        // 4. Bettors claim
        // rake = 2000e6 * 7.5% = 150 USDC, remaining = 1850 USDC
        // Bettor1 gets: (500/1000) * 1850 = 925 USDC
        uint256 bettor1Before = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor1) - bettor1Before, 925 * 1e6);

        // Bettor2 gets: (500/1000) * 1850 = 925 USDC
        uint256 bettor2Before = usdc.balanceOf(bettor2);
        vm.prank(bettor2);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor2) - bettor2Before, 925 * 1e6);

        // Loser gets nothing
        vm.prank(bettor3);
        vm.expectRevert("No winning bets");
        pool.claimWinnings(poolId);
    }

    // ==================== DRAW AUTO-RESOLUTION TESTS ====================

    function test_ResolvePool_MatchLinked_Draw() public {
        // Setup: Create and settle a match as draw
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);

        vm.prank(player2);
        escrow.joinMatchExternal(1);

        // Create pool linked to the match
        string[] memory outcomes = new string[](2);
        outcomes[0] = "Player A";
        outcomes[1] = "Player B";
        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            block.timestamp + 1 hours,
            "Who wins?",
            outcomes
        );

        // Place bets
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        // Settle match as DRAW (no winner set)
        escrow.settleMatchDraw(1);

        // Verify getMatchWinner returns address(0)
        assertEq(escrow.getMatchWinner(1), address(0));

        // Warp past betting deadline
        vm.warp(block.timestamp + 2 hours);

        // resolvePool should auto-detect draw and resolve accordingly
        pool.resolvePool(poolId);

        PredictionPool.Pool memory p = pool.getPool(poolId);
        assertTrue(p.resolved);
        assertTrue(p.isDraw);
    }

    function test_ResolvePool_MatchLinked_Draw_ClaimRefund() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        vm.prank(player2);
        escrow.joinMatchExternal(1);

        string[] memory outcomes = new string[](2);
        outcomes[0] = "Player A";
        outcomes[1] = "Player B";
        uint256 poolId = pool.createPool(
            address(escrow),
            1,
            block.timestamp + 1 hours,
            "Who wins?",
            outcomes
        );

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        escrow.settleMatchDraw(1);
        vm.warp(block.timestamp + 2 hours);
        pool.resolvePool(poolId);

        // Both bettors get full refunds (no rake on draw)
        uint256 b1Before = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor1) - b1Before, 100 * 1e6);

        uint256 b2Before = usdc.balanceOf(bettor2);
        vm.prank(bettor2);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor2) - b2Before, 200 * 1e6);
    }

    // --- WITHDRAW (nothing queued) ---

    function test_Withdraw_NothingToWithdraw() public {
        vm.prank(bettor1);
        vm.expectRevert("Nothing to withdraw");
        pool.withdraw();
    }

    // --- MULTI-OUTCOME BETTOR IN WIN SCENARIO ---

    function test_BettorBetsMultipleOutcomes_WinScenario() public {
        // bettor1 bets on BOTH outcomes (hedging)
        // bettor2 bets only on outcome 0
        string[] memory outcomes = new string[](2);
        outcomes[0] = "A";
        outcomes[1] = "B";
        uint256 poolId = pool.createPool(
            address(0),
            0,
            block.timestamp + 1 hours,
            "Standalone",
            outcomes
        );

        // bettor1 bets 100 on outcome 0 and 50 on outcome 1
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 100 * 1e6);
        vm.prank(bettor1);
        pool.placeBet(poolId, 1, 50 * 1e6);

        // bettor2 bets 100 on outcome 0
        vm.prank(bettor2);
        pool.placeBet(poolId, 0, 100 * 1e6);

        // totalPool = 250e6, outcomeTotals[0] = 200e6, outcomeTotals[1] = 50e6

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0); // outcome 0 wins

        // bettor1 should only collect their outcome 0 bet
        // rake = 250e6 * 750 / 10000 = 18_750_000
        // remaining = 250e6 - 18_750_000 = 231_250_000
        // bettor1 payout = (100e6 / 200e6) * 231_250_000 = 115_625_000
        uint256 b1Before = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor1) - b1Before, 115_625_000);

        // bettor2 payout = (100e6 / 200e6) * 231_250_000 = 115_625_000
        uint256 b2Before = usdc.balanceOf(bettor2);
        vm.prank(bettor2);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor2) - b2Before, 115_625_000);

        // bettor1's losing bet on outcome 1 (50e6) is NOT refunded — correct parimutuel behavior
        // bettor1 cannot claim again
        vm.prank(bettor1);
        vm.expectRevert("Already claimed");
        pool.claimWinnings(poolId);
    }
}

// ---------------------------------------------------------------------------
// Pull-payment tests using BlocklistMockUSDC
// ---------------------------------------------------------------------------

contract PredictionPoolPullPaymentTest is Test {
    PredictionPool pool;
    BlocklistMockUSDC usdc;

    address treasury = address(0x123);
    address bettor1  = address(0x456);
    address bettor2  = address(0x789);

    function setUp() public {
        usdc = new BlocklistMockUSDC();
        pool = new PredictionPool(treasury, address(usdc));

        usdc.mint(bettor1, 10_000 * 1e6);
        usdc.mint(bettor2, 10_000 * 1e6);

        vm.prank(bettor1);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bettor2);
        usdc.approve(address(pool), type(uint256).max);
    }

    // Helper: create a simple standalone 2-outcome pool with bettingDeadline 1 hour out
    function _createPool() internal returns (uint256 poolId) {
        string[] memory outcomes = new string[](2);
        outcomes[0] = "A";
        outcomes[1] = "B";
        poolId = pool.createPool(address(0), 0, block.timestamp + 1 hours, "Test", outcomes);
    }

    function test_PullPayment_BlocklistedWinner() public {
        uint256 poolId = _createPool();

        // bettor1 bets on outcome 0, bettor2 on outcome 1
        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 200 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0); // outcome 0 wins

        // Blocklist bettor1 before they claim
        usdc.blocklist(bettor1);

        // claimWinnings should succeed (not revert) but queue the payout
        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        uint256 pending = pool.pendingWithdrawals(bettor1);
        assertTrue(pending > 0, "Should have pending withdrawal");
        // rake = 400e6 * 750 / 10000 = 30e6, remaining = 370e6 — all to bettor1
        assertEq(pending, 370 * 1e6);
    }

    function test_Withdraw_AfterUnblocklisted() public {
        uint256 poolId = _createPool();

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 200 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        usdc.blocklist(bettor1);

        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        uint256 pending = pool.pendingWithdrawals(bettor1);
        assertTrue(pending > 0);

        // Un-blocklist and withdraw
        usdc.unblocklist(bettor1);

        uint256 balBefore = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        pool.withdraw();

        assertEq(pool.pendingWithdrawals(bettor1), 0);
        assertEq(usdc.balanceOf(bettor1) - balBefore, pending);
    }

    function test_PullPayment_BlocklistedDraw() public {
        uint256 poolId = _createPool();

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 150 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 100 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolDraw(poolId);

        // Blocklist bettor1 before refund
        usdc.blocklist(bettor1);

        vm.prank(bettor1);
        pool.claimWinnings(poolId); // should not revert

        // Full refund queued (no rake on draw)
        assertEq(pool.pendingWithdrawals(bettor1), 150 * 1e6);

        // bettor2 (not blocklisted) gets direct refund
        uint256 b2Before = usdc.balanceOf(bettor2);
        vm.prank(bettor2);
        pool.claimWinnings(poolId);
        assertEq(usdc.balanceOf(bettor2) - b2Before, 100 * 1e6);
    }

    function test_WithdrawalQueued_Event() public {
        uint256 poolId = _createPool();

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 200 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        usdc.blocklist(bettor1);

        vm.expectEmit(true, false, false, true);
        emit PredictionPool.WithdrawalQueued(bettor1, 370 * 1e6);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);
    }

    function test_Withdrawn_Event() public {
        uint256 poolId = _createPool();

        vm.prank(bettor1);
        pool.placeBet(poolId, 0, 200 * 1e6);
        vm.prank(bettor2);
        pool.placeBet(poolId, 1, 200 * 1e6);

        vm.warp(block.timestamp + 2 hours);
        pool.resolvePoolManual(poolId, 0);

        usdc.blocklist(bettor1);
        vm.prank(bettor1);
        pool.claimWinnings(poolId);

        usdc.unblocklist(bettor1);

        vm.expectEmit(true, false, false, true);
        emit PredictionPool.Withdrawn(bettor1, 370 * 1e6);
        vm.prank(bettor1);
        pool.withdraw();
    }
}
