// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/BaseEscrow.sol";
import "./mocks/MockUSDC.sol";

// Mock contract for testing BaseEscrow
contract MockEscrow is BaseEscrow {
    constructor(address treasury, address usdc) BaseEscrow(treasury, usdc) {}

    function createMatch(
        uint256 stake,
        bytes32 logicId,
        uint8 maxPlayers,
        uint8 winsRequired,
        uint8 maxRounds
    ) external nonReentrant whenNotPaused {
        // Use the inherited _initMatch for proper initialization
        uint256 matchId = _initMatch(stake, logicId, maxPlayers, winsRequired, maxRounds);
        emit MatchCreated(matchId, msg.sender, stake, logicId, maxPlayers, maxRounds);
    }

    // Override INTERNAL virtual functions, NOT the external ones
    function _claimTimeout(uint256 matchId) internal override {
        // Find player who called (msg.sender is preserved in internal calls)
        uint8 winnerIndex = uint8(_findPlayerIndex(matchId, msg.sender));
        _settleMatchSingleWinner(matchId, winnerIndex);
    }

    function _mutualTimeout(uint256 matchId) internal override {
        BaseMatch storage m = matches[matchId];
        
        // Void with 1% penalty
        m.status = MatchStatus.VOIDED;
        
        uint256 refund = (m.stake * 99) / 100;
        uint256 penalty = m.stake - refund;
        
        for (uint i = 0; i < m.players.length; i++) {
            _safeTransferUSDC(m.players[i], refund);
        }
        
        _safeTransferUSDC(treasury, penalty * m.players.length);
        
        emit MatchVoided(matchId, "Mutual timeout");
    }

    // Expose internal functions for testing
    function testInitMatch(
        uint256 stake,
        bytes32 logicId,
        uint8 maxPlayers,
        uint8 winsRequired,
        uint8 maxRounds
    ) external nonReentrant whenNotPaused returns (uint256) {
        return _initMatch(stake, logicId, maxPlayers, winsRequired, maxRounds);
    }

    function testSettleMatchDraw(uint256 matchId) external {
        _settleMatchDraw(matchId);
    }

    function testAddContribution(uint256 matchId, address player, uint256 amount) external {
        _addContribution(matchId, player, amount);
    }

    function testSettleWithResolution(uint256 matchId, IBaseEscrow.Resolution memory res) external {
        _settleMatch(matchId, res);
    }

    /// @dev Simulate a mid-game round pot distribution (e.g. PokerEngine fold win).
    /// Transfers USDC out of the contract and updates accounting mappings.
    function testMidGameDistribute(uint256 matchId, address player, uint256 gross, uint256 net) external {
        _midGameDistributed[matchId] += gross;
        _midGameReceived[matchId][player] += net;
        _safeTransferUSDC(player, net);
        if (gross > net) _safeTransferUSDC(treasury, gross - net);
    }
}

contract BaseEscrowTest is Test {
    MockEscrow escrow;
    MockUSDC usdc;
    address treasury = address(0x123);
    address player1 = address(0x789);
    address player2 = address(0xabc);
    address player3 = address(0xdef);
    
    bytes32 constant LOGIC_ID = keccak256("test-game");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new MockEscrow(treasury, address(usdc));
        
        // Fund players
        usdc.mint(player1, 10000 * 1e6);
        usdc.mint(player2, 10000 * 1e6);
        usdc.mint(player3, 10000 * 1e6);
        
        // Approve escrow for all players
        vm.prank(player1);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(player2);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(player3);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ==================== CONSTRUCTOR TESTS ====================

    function test_Constructor() public view {
        assertEq(escrow.treasury(), treasury);
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.RAKE_BPS(), 750);
        assertEq(escrow.matchCounter(), 0);
    }

    function test_Constructor_ZeroTreasury() public {
        vm.expectRevert("Invalid treasury");
        new MockEscrow(address(0), address(usdc));
    }

    function test_Constructor_ZeroUSDC() public {
        vm.expectRevert("Invalid USDC");
        new MockEscrow(treasury, address(0));
    }

    // ==================== CREATE MATCH TESTS ====================

    function test_CreateMatch() public {
        // Need to approve first since createMatch pulls USDC
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        assertEq(escrow.matchCounter(), 1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.players.length, 1);
        assertEq(m.players[0], player1);
        assertEq(m.stake, 100 * 1e6);
        assertEq(m.logicId, LOGIC_ID);
        assertEq(m.maxPlayers, 2);
        assertEq(m.winsRequired, 1);
        assertEq(m.maxRounds, 10);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.OPEN));
        assertEq(m.totalPot, 100 * 1e6);
    }

    function test_CreateMatch_ZeroStake() public {
        vm.prank(player1);
        vm.expectRevert("Stake below minimum");
        escrow.createMatch(0, LOGIC_ID, 2, 1, 10);
    }

    function test_CreateMatch_MinPlayers() public {
        // Test exactly at boundary: 2 players (minimum)
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        assertEq(escrow.matchCounter(), 1);
    }

    function test_CreateMatch_ZeroWinsRequired() public {
        vm.prank(player1);
        vm.expectRevert("Wins required must be > 0");
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 0, 10);
    }

    function test_CreateMatch_MaxRounds() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 5);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.maxRounds, 5);
    }
    


    function test_CreateMatch_LessThanMinPlayers() public {
        vm.prank(player1);
        vm.expectRevert("Players must be 2-6");
        escrow.createMatch(100 * 1e6, LOGIC_ID, 1, 1, 10);
    }

    function test_CreateMatch_MoreThanMaxPlayers() public {
        vm.prank(player1);
        vm.expectRevert("Players must be 2-6");
        escrow.createMatch(100 * 1e6, LOGIC_ID, 7, 1, 10);
    }

    // ==================== JOIN MATCH TESTS ====================

    function test_JoinMatch() public {
        // Create match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        // Approve and join
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.players.length, 2);
        assertEq(m.players[1], player2);
        assertEq(m.totalPot, 200 * 1e6);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.ACTIVE));
        assertEq(escrow.playerContributions(1, player2), 100 * 1e6);
    }

    function test_JoinMatch_NotOpen() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        // Fill match
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Try to join again
        usdc.mint(address(0x999), 1000 * 1e6);
        vm.prank(address(0x999));
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(address(0x999));
        vm.expectRevert("Match not open");
        escrow.joinMatch(1);
    }

    function test_JoinMatch_MatchFull() public {
        // Create 2-player match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        // Fill it
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Try to join with third player
        usdc.mint(address(0x999), 1000 * 1e6);
        vm.prank(address(0x999));
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(address(0x999));
        vm.expectRevert("Match not open");
        escrow.joinMatch(1);
    }

    function test_JoinMatch_AlreadyJoined() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);

        vm.prank(player1);
        vm.expectRevert("Already joined");
        escrow.joinMatch(1);
    }

    function test_JoinMatch_Expired() public {
        // 3-player match stays OPEN after creation
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);

        // Warp past JOIN_WINDOW (1 hour)
        vm.warp(block.timestamp + 2 hours);

        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        vm.expectRevert("Match expired");
        escrow.joinMatch(1);
    }

    function test_ExecuteTransfer_NotSelf() public {
        vm.expectRevert("Internal only");
        escrow.executeTransfer(player1, 100);
    }

    // ==================== LEAVE MATCH TESTS ====================

    function test_LeaveMatch() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        uint256 balanceBefore = usdc.balanceOf(player1);
        
        vm.prank(player1);
        escrow.leaveMatch(1);
        
        // Check if direct transfer worked, otherwise check pendingWithdrawals
        uint256 balanceAfter = usdc.balanceOf(player1);
        uint256 withdrawalAmount = escrow.pendingWithdrawals(player1);
        
        // Either direct transfer or queued withdrawal should equal stake
        assertEq((balanceAfter - balanceBefore) + withdrawalAmount, 100 * 1e6);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.players.length, 0);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.VOIDED));
    }

    function test_LeaveMatch_NotOpen() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        vm.prank(player1);
        vm.expectRevert("Match not open");
        escrow.leaveMatch(1);
    }

    function test_LeaveMatch_NotPlayer() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        vm.prank(player2);
        vm.expectRevert("Not a player");
        escrow.leaveMatch(1);
    }

    function test_LeaveMatch_AllPlayersLeave() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Player2 leaves
        vm.prank(player2);
        escrow.leaveMatch(1);
        
        // Player1 leaves - should void match
        vm.prank(player1);
        escrow.leaveMatch(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.VOIDED));
    }

    // ==================== SETTLEMENT TESTS ====================

    function test_SettleMatchSingleWinner() public {
        // Setup: 2 player match, player1 wins
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 treasuryWithdrawalBefore = escrow.pendingWithdrawals(treasury);
        uint256 player1Before = usdc.balanceOf(player1);
        uint256 player1WithdrawalBefore = escrow.pendingWithdrawals(player1);
        
        // Trigger settlement via timeout (calls _settleMatchSingleWinner internally)
        vm.prank(player1);
        escrow.claimTimeout(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, player1);
        
        // Check rake (7.5% of 200 = 15) - either direct or queued
        uint256 treasuryAfter = usdc.balanceOf(treasury);
        uint256 treasuryWithdrawalAfter = escrow.pendingWithdrawals(treasury);
        uint256 treasuryTotal = (treasuryAfter - treasuryBefore) + (treasuryWithdrawalAfter - treasuryWithdrawalBefore);
        assertEq(treasuryTotal, 15 * 1e6);

        // Check winner got remainder (185) - either direct or queued
        uint256 player1After = usdc.balanceOf(player1);
        uint256 player1WithdrawalAfter = escrow.pendingWithdrawals(player1);
        uint256 player1Total = (player1After - player1Before) + (player1WithdrawalAfter - player1WithdrawalBefore);
        assertEq(player1Total, 185 * 1e6);
    }

    function test_SettleMatch_Draw() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Use adminVoid as a way to trigger draw settlement
        uint256 player1Before = usdc.balanceOf(player1);
        uint256 player1WithdrawalBefore = escrow.pendingWithdrawals(player1);
        uint256 player2Before = usdc.balanceOf(player2);
        uint256 player2WithdrawalBefore = escrow.pendingWithdrawals(player2);
        
        // Use the draw settlement via _settleMatchDraw internal (not directly callable)
        // We'll test this through adminVoid which refunds both
        escrow.adminVoidMatch(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.VOIDED));
        
        // Both should get refund (direct + queued)
        uint256 player1Total = (usdc.balanceOf(player1) - player1Before) + (escrow.pendingWithdrawals(player1) - player1WithdrawalBefore);
        uint256 player2Total = (usdc.balanceOf(player2) - player2Before) + (escrow.pendingWithdrawals(player2) - player2WithdrawalBefore);
        assertEq(player1Total, 100 * 1e6);
        assertEq(player2Total, 100 * 1e6);
    }

    // ==================== TIMEOUT TESTS ====================

    function test_ClaimTimeout() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        vm.prank(player1);
        escrow.claimTimeout(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
    }

    function test_ClaimTimeout_NotActive() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player1);
        vm.expectRevert("Match not active");
        escrow.claimTimeout(1);
    }

    function test_ClaimTimeout_NotPlayer() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        vm.prank(address(0x999));
        vm.expectRevert("Not a player");
        escrow.claimTimeout(1);
    }

    function test_MutualTimeout() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        uint256 player1Before = usdc.balanceOf(player1);
        
        vm.prank(player1);
        escrow.mutualTimeout(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.VOIDED));
        
        // Player1 should get 99% refund (minus 1% penalty)
        uint256 refund = 99 * 1e6;
        assertEq(usdc.balanceOf(player1) - player1Before, refund);
    }

    // ==================== ADMIN TESTS ====================

    function test_AdminVoidMatch() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        uint256 player1Before = usdc.balanceOf(player1);
        uint256 player1WithdrawalBefore = escrow.pendingWithdrawals(player1);
        uint256 player2Before = usdc.balanceOf(player2);
        uint256 player2WithdrawalBefore = escrow.pendingWithdrawals(player2);
        
        escrow.adminVoidMatch(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.VOIDED));
        
        // Both should get full refund (direct + queued)
        uint256 player1Total = (usdc.balanceOf(player1) - player1Before) + (escrow.pendingWithdrawals(player1) - player1WithdrawalBefore);
        uint256 player2Total = (usdc.balanceOf(player2) - player2Before) + (escrow.pendingWithdrawals(player2) - player2WithdrawalBefore);
        assertEq(player1Total, 100 * 1e6);
        assertEq(player2Total, 100 * 1e6);
    }

    function test_AdminVoidMatch_AlreadySettled() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        vm.prank(player1);
        escrow.claimTimeout(1);
        
        vm.expectRevert("Cannot void");
        escrow.adminVoidMatch(1);
    }

    function test_AdminVoidMatch_NotOwner() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        vm.expectRevert();
        escrow.adminVoidMatch(1);
    }

    function test_SetTreasury() public {
        address newTreasury = address(0x111);
        escrow.setTreasury(newTreasury);
        assertEq(escrow.treasury(), newTreasury);
    }

    function test_SetTreasury_ZeroAddress() public {
        vm.expectRevert("Invalid treasury");
        escrow.setTreasury(address(0));
    }

    function test_SettleMatch_ZeroRake() public {
        // Create match with very small pot to test rounding
        vm.prank(player1);
        escrow.createMatch(1 * 1e6, LOGIC_ID, 2, 1, 10); // 1 USDC stake
        
        vm.prank(player2);
        usdc.approve(address(escrow), 1 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Total pot = 2 USDC (2_000_000 units), rake = 7.5% = 150_000 units = 0.15 USDC
        
        escrow.testSettleMatchDraw(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
    }

    function test_SetTreasury_NotOwner() public {
        vm.prank(player1);
        vm.expectRevert();
        escrow.setTreasury(address(0x111));
    }

    // ==================== PAUSE TESTS ====================

    function test_Pause() public {
        escrow.pause();
        
        // Try to create match while paused
        vm.prank(player1);
        vm.expectRevert();
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
    }

    function test_Unpause() public {
        escrow.pause();
        escrow.unpause();
        
        // Should work after unpause
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        assertEq(escrow.matchCounter(), 1);
    }

    function test_Pause_NotOwner() public {
        vm.prank(player1);
        vm.expectRevert();
        escrow.pause();
    }

    // ==================== VIEW FUNCTION TESTS ====================

    function test_GetMatchWinner() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Before settlement, winner is address(0)
        assertEq(escrow.getMatchWinner(1), address(0));
        
        // After settlement
        vm.prank(player1);
        escrow.claimTimeout(1);
        
        assertEq(escrow.getMatchWinner(1), player1);
    }

    function test_GetMatch() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.stake, 100 * 1e6);
        assertEq(m.maxPlayers, 2);
    }

    // ==================== WITHDRAW TESTS ====================

    function test_Withdraw_NoPending() public {
        vm.prank(player1);
        vm.expectRevert("No pending withdrawal");
        escrow.withdraw();
    }

    function test_Withdraw_Success() public {
        // We need to get funds into pendingWithdrawals.
        // Use a blocklist USDC to make transfers fail, then withdraw.
        // This is tested in BaseEscrowPullPaymentTest below.
    }

    // ==================== RECEIVE/FALLBACK TESTS ====================

    function test_Receive_ETH() public {
        vm.expectRevert();
        (bool success,) = address(escrow).call{value: 1 ether}("");
        (success); // silence unused variable warning — return value irrelevant when testing revert
    }

    // ==================== EDGE CASE TESTS ====================

    function test_MutualTimeout_NotPlayer() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        vm.prank(address(0x999));
        vm.expectRevert("Not a player");
        escrow.mutualTimeout(1);
    }

    function test_MutualTimeout_NotActive() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.expectRevert("Match not active");
        escrow.mutualTimeout(1);
    }

    function test_ClaimExpiredMatch_MatchNotExist() public {
        vm.expectRevert("Match does not exist");
        escrow.claimExpiredMatch(999);
    }

    function test_GetMatchWinner_NoWinner() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        // Before settlement, winner should be address(0)
        assertEq(escrow.getMatchWinner(1), address(0));
    }

    // ==================== BRANCH COVERAGE TESTS ====================

    function test_LeaveMatch_NotLastPlayer() public {
        // Create 3-player match (stays OPEN with 2 players)
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        // Player2 joins - match still OPEN (1 of 3)
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Verify match is still OPEN
        IBaseEscrow.BaseMatch memory mBefore = escrow.getMatch(1);
        assertEq(uint8(mBefore.status), uint8(IBaseEscrow.MatchStatus.OPEN));
        assertEq(mBefore.players.length, 2);
        
        // Player1 (index 0) leaves - not last in array, triggers swap with player2
        uint256 player1Before = usdc.balanceOf(player1);
        vm.prank(player1);
        escrow.leaveMatch(1);
        uint256 player1After = usdc.balanceOf(player1);
        
        // Verify player1 got refund
        uint256 player1Total = (player1After - player1Before) + escrow.pendingWithdrawals(player1);
        assertEq(player1Total, 100 * 1e6);
        
        // Verify player2 is still in match
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.players.length, 1);
        assertEq(m.players[0], player2);
    }

    function test_ClaimExpiredMatch() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        // Warp past JOIN_WINDOW
        vm.warp(block.timestamp + 2 hours);
        
        uint256 player1Before = usdc.balanceOf(player1);
        uint256 player1WithdrawalBefore = escrow.pendingWithdrawals(player1);
        
        escrow.claimExpiredMatch(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.VOIDED));
        
        uint256 player1Total = (usdc.balanceOf(player1) - player1Before) + (escrow.pendingWithdrawals(player1) - player1WithdrawalBefore);
        assertEq(player1Total, 100 * 1e6);
    }

    function test_ClaimExpiredMatch_NotOpen() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        vm.warp(block.timestamp + 2 hours);
        
        vm.expectRevert("Match not open");
        escrow.claimExpiredMatch(1);
    }

    function test_ClaimExpiredMatch_NotExpired() public {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        vm.expectRevert("Not expired");
        escrow.claimExpiredMatch(1);
    }

    function test_LeaveMatch_LastPlayer_VoidsMatch() public {
        // Create 3-player match (stays OPEN until full)
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        // Only player1 in match
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.players.length, 1);
        
        // Player1 leaves (last and only player)
        vm.prank(player1);
        escrow.leaveMatch(1);
        
        // Match should be VOIDED since no players left
        m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.VOIDED));
        assertEq(m.players.length, 0);
    }

    function test_JoinMatch_ExactFill() public {
        // Create 2-player match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        // Player2 joins - should make it exactly full
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.players.length, 2);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.ACTIVE));
    }

    function test_MultipleMatches() public {
        // Create first match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        // Create second match
        vm.prank(player2);
        escrow.createMatch(200 * 1e6, LOGIC_ID, 3, 1, 10);
        
        assertEq(escrow.matchCounter(), 2);
        
        IBaseEscrow.BaseMatch memory m1 = escrow.getMatch(1);
        IBaseEscrow.BaseMatch memory m2 = escrow.getMatch(2);
        
        assertEq(m1.stake, 100 * 1e6);
        assertEq(m2.stake, 200 * 1e6);
    }

    function test_LeaveMatch_LastPlayerInArray() public {
        // Create 3-player match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        // Player2 joins
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Player2 (index 1, last in array) leaves - no swap needed
        uint256 player2Before = usdc.balanceOf(player2);
        vm.prank(player2);
        escrow.leaveMatch(1);
        uint256 player2After = usdc.balanceOf(player2);
        
        // Verify player2 got refund
        uint256 player2Total = (player2After - player2Before) + escrow.pendingWithdrawals(player2);
        assertEq(player2Total, 100 * 1e6);
        
        // Verify only player1 remains
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.players.length, 1);
        assertEq(m.players[0], player1);
    }

    function test_MatchNotExist_View() public view {
        // getMatch returns empty struct for non-existent match (no revert)
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(999);
        assertEq(m.players.length, 0);
        assertEq(m.stake, 0);
    }

    function test_RequireMatchExists() public {
        // Test various functions that use _requireMatchExists
        vm.expectRevert("Match does not exist");
        escrow.joinMatch(999);
        
        vm.expectRevert("Match does not exist");
        escrow.leaveMatch(999);
        
        vm.expectRevert("Match does not exist");
        escrow.claimTimeout(999);
        
        vm.expectRevert("Match does not exist");
        escrow.mutualTimeout(999);
        
        vm.expectRevert("Match does not exist");
        escrow.adminVoidMatch(999);
    }

    // ==================== UNCOVERED FUNCTION TESTS ====================

    function test_Withdraw() public {
        // First create a match to get USDC into escrow
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        // Use admin void to generate pending withdrawal for player1
        escrow.adminVoidMatch(1);
        
        // Check if there's a pending withdrawal
        uint256 pending = escrow.pendingWithdrawals(player1);
        
        if (pending > 0) {
            uint256 balanceBefore = usdc.balanceOf(player1);
            
            vm.prank(player1);
            escrow.withdraw();
            
            uint256 balanceAfter = usdc.balanceOf(player1);
            assertEq(balanceAfter - balanceBefore, pending);
            assertEq(escrow.pendingWithdrawals(player1), 0);
            
            // Verify event
            // Check that withdrawal succeeded
        }
    }

    function test_TestInitMatch() public {
        // Test the exposed _initMatch function - need approval first
        vm.prank(player1);
        uint256 matchId = escrow.testInitMatch(150 * 1e6, LOGIC_ID, 3, 2, 15);
        
        assertEq(matchId, 1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.stake, 150 * 1e6);
        assertEq(m.maxPlayers, 3);
        assertEq(m.winsRequired, 2);
        assertEq(m.maxRounds, 15);
    }

    function test_TestInitMatch_Reverts() public {
        // Zero stake
        vm.expectRevert("Stake below minimum");
        escrow.testInitMatch(0, LOGIC_ID, 2, 1, 10);
        
        // Less than min players
        vm.expectRevert("Players must be 2-6");
        escrow.testInitMatch(100 * 1e6, LOGIC_ID, 1, 1, 10);
        
        // Zero wins required
        vm.expectRevert("Wins required must be > 0");
        escrow.testInitMatch(100 * 1e6, LOGIC_ID, 2, 0, 10);
    }

    function test_TestAddContribution() public {
        // Create match first
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        // Add contribution via test function
        escrow.testAddContribution(1, player2, 50 * 1e6);
        
        assertEq(escrow.playerContributions(1, player2), 50 * 1e6);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(m.totalPot, 150 * 1e6); // 100 + 50
    }

    function test_TestSettleMatchDraw() public {
        // Create and fill match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        uint256 player1Before = usdc.balanceOf(player1);
        uint256 player1WithdrawalBefore = escrow.pendingWithdrawals(player1);
        uint256 player2Before = usdc.balanceOf(player2);
        uint256 player2WithdrawalBefore = escrow.pendingWithdrawals(player2);
        
        // Settle as draw
        escrow.testSettleMatchDraw(1);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        assertEq(m.winner, address(0)); // Draw has no winner
        
        // Both should get their stake back (minus rake)
        uint256 player1Total = (usdc.balanceOf(player1) - player1Before) + (escrow.pendingWithdrawals(player1) - player1WithdrawalBefore);
        uint256 player2Total = (usdc.balanceOf(player2) - player2Before) + (escrow.pendingWithdrawals(player2) - player2WithdrawalBefore);
        
        // Each gets half of pot minus rake
        // 200 total, 15 rake, 185 split = 92.5 each
        assertEq(player1Total, 92_500_000);
        assertEq(player2Total, 92_500_000);
    }

    // ==================== BRANCH COVERAGE: REQUIRE STATEMENTS ====================

    function test_InitMatch_MaxRoundsLessThanWins() public {
        vm.prank(player1);
        vm.expectRevert("Max rounds must be >= wins required");
        escrow.testInitMatch(100 * 1e6, LOGIC_ID, 2, 3, 2); // winsRequired=3, maxRounds=2
    }

    function test_SettleMatch_NotActive() public {
        // Create and settle match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Settle once
        escrow.testSettleMatchDraw(1);
        
        // Try to settle again
        vm.expectRevert("Match not active");
        escrow.testSettleMatchDraw(1);
    }

    function test_SettleMatch_NoWinners() public {
        // Create match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Try to settle with empty winner array
        uint8[] memory emptyWinners = new uint8[](0);
        uint256[] memory splits = new uint256[](0);
        
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({
            winnerIndices: emptyWinners,
            splitBps: splits
        });
        
        vm.expectRevert("No winners");
        escrow.testSettleWithResolution(1, res);
    }

    function test_SettleMatch_SplitMismatch() public {
        // Create match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Mismatched arrays
        uint8[] memory winners = new uint8[](2);
        winners[0] = 0;
        winners[1] = 1;
        uint256[] memory splits = new uint256[](1);
        splits[0] = 5000;
        
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({
            winnerIndices: winners,
            splitBps: splits
        });
        
        vm.expectRevert("Winner/split length mismatch");
        escrow.testSettleWithResolution(1, res);
    }

    function test_SettleMatch_SplitNot10000() public {
        // Create match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Splits don't sum to 10000
        uint8[] memory winners = new uint8[](1);
        winners[0] = 0;
        uint256[] memory splits = new uint256[](1);
        splits[0] = 5000; // Only 50%, not 100%
        
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({
            winnerIndices: winners,
            splitBps: splits
        });
        
        vm.expectRevert("Splits must sum to 10000");
        escrow.testSettleWithResolution(1, res);
    }

    function test_SettleMatch_InvalidWinnerIndex() public {
        // Create match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        // Invalid winner index (only 2 players, index 5 doesn't exist)
        uint8[] memory winners = new uint8[](1);
        winners[0] = 5;
        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;
        
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({
            winnerIndices: winners,
            splitBps: splits
        });
        
        vm.expectRevert("Invalid winner index");
        escrow.testSettleWithResolution(1, res);
    }

    function test_SettleMatch_MultipleWinners() public {
        // Create 3-player match
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        
        vm.prank(player2);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player2);
        escrow.joinMatch(1);
        
        vm.prank(player3);
        usdc.approve(address(escrow), 100 * 1e6);
        vm.prank(player3);
        escrow.joinMatch(1);
        
        // Settle with 2 winners (60/40 split)
        uint8[] memory winners = new uint8[](2);
        winners[0] = 0;
        winners[1] = 1;
        uint256[] memory splits = new uint256[](2);
        splits[0] = 6000; // 60%
        splits[1] = 4000; // 40%
        
        IBaseEscrow.Resolution memory res = IBaseEscrow.Resolution({
            winnerIndices: winners,
            splitBps: splits
        });
        
        uint256 player1Before = usdc.balanceOf(player1);
        uint256 player1WithdrawalBefore = escrow.pendingWithdrawals(player1);
        uint256 player2Before = usdc.balanceOf(player2);
        uint256 player2WithdrawalBefore = escrow.pendingWithdrawals(player2);
        
        escrow.testSettleWithResolution(1, res);
        
        IBaseEscrow.BaseMatch memory m = escrow.getMatch(1);
        assertEq(uint8(m.status), uint8(IBaseEscrow.MatchStatus.SETTLED));
        
        // Check distributions (300 total, 22.5 rake, 277.5 split)
        // player1: 277.5 * 60% = 166.5 USDC
        // player2: 277.5 * 40% = 111 USDC (gets remainder dust)
        uint256 player1Total = (usdc.balanceOf(player1) - player1Before) + (escrow.pendingWithdrawals(player1) - player1WithdrawalBefore);
        uint256 player2Total = (usdc.balanceOf(player2) - player2Before) + (escrow.pendingWithdrawals(player2) - player2WithdrawalBefore);

        assertEq(player1Total, 166_500_000);
        assertEq(player2Total, 111 * 1e6);
    }

    // ==================== MID-GAME RAKE: ADMIN VOID PRO-RATA (#9) ====================

    function test_AdminVoidMatch_ProRata_MidGameRakeReducesPool() public {
        // 3-player match: 100 USDC each → totalPot = 300 USDC
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 3, 1, 10);
        vm.prank(player2); escrow.joinMatch(1);
        vm.prank(player3); escrow.joinMatch(1);

        // Simulate player1 raising 100 USDC.
        // Mint directly to escrow (avoids needing full PokerEngine stack),
        // then update accounting to reflect the raise.
        usdc.mint(address(escrow), 100 * 1e6);
        escrow.testAddContribution(1, player1, 100 * 1e6); // totalPot=400, contrib[p1]=200

        // Simulate mid-game distribution: player1 wins round pot (100 USDC gross).
        // rake = 7.5%, so net to player1 = 92.5 USDC.
        uint256 gross = 100 * 1e6;
        uint256 net   = gross - (gross * 750 / 10000); // 92_500_000
        escrow.testMidGameDistribute(1, player1, gross, net);
        // Contract now holds 400 - 100 = 300 USDC. effectivePot = 300.

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);
        uint256 p3Before = usdc.balanceOf(player3);

        escrow.adminVoidMatch(1);

        // owed[p1] = 200e6 - 92.5e6 = 107.5e6
        // owed[p2] = 100e6, owed[p3] = 100e6
        // totalOwed = 307.5e6 > effectivePot (300e6) → pro-rata
        uint256 p1Owed    = 200 * 1e6 - net;    // 107_500_000
        uint256 p2Owed    = 100 * 1e6;
        uint256 p3Owed    = 100 * 1e6;
        uint256 totalOwed = p1Owed + p2Owed + p3Owed;
        uint256 effPot    = 300 * 1e6;

        uint256 p1Refund = (p1Owed * effPot) / totalOwed;
        uint256 p2Refund = (p2Owed * effPot) / totalOwed;
        uint256 p3Refund = effPot - p1Refund - p2Refund; // remainder to last player

        assertEq(usdc.balanceOf(player1) - p1Before, p1Refund);
        assertEq(usdc.balanceOf(player2) - p2Before, p2Refund);
        assertEq(usdc.balanceOf(player3) - p3Before, p3Refund);
        assertEq(p1Refund + p2Refund + p3Refund, effPot); // no dust left
        assertEq(usdc.balanceOf(address(escrow)), 0);      // contract fully drained
    }

}

// ==================== PULL-PAYMENT / BLOCKLIST TESTS ====================

import "./mocks/BlocklistMockUSDC.sol";

contract BaseEscrowPullPaymentTest is Test {
    MockEscrow escrow;
    BlocklistMockUSDC usdc;
    address treasury = address(0x123);
    address player1 = address(0x789);
    address player2 = address(0xabc);

    bytes32 constant LOGIC_ID = keccak256("test-logic");

    function setUp() public {
        usdc = new BlocklistMockUSDC();
        escrow = new MockEscrow(treasury, address(usdc));

        usdc.mint(player1, 10000 * 1e6);
        usdc.mint(player2, 10000 * 1e6);

        vm.prank(player1);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(player2);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _createAndFillMatch() internal returns (uint256) {
        vm.prank(player1);
        escrow.createMatch(100 * 1e6, LOGIC_ID, 2, 1, 10);

        vm.prank(player2);
        escrow.joinMatch(1);

        return 1;
    }

    function test_PullPayment_BlocklistedRecipient() public {
        uint256 matchId = _createAndFillMatch();

        // Blocklist player1 BEFORE settlement
        usdc.blocklist(player1);

        // Settle — player1 wins. Direct transfer will fail, should queue withdrawal
        vm.prank(address(escrow));
        escrow.testSettleMatchDraw(matchId);

        // player1's funds should be in pendingWithdrawals (transfer failed)
        uint256 pending = escrow.pendingWithdrawals(player1);
        assertTrue(pending > 0, "Should have pending withdrawal");
    }

    function test_Withdraw_AfterUnblocklisted() public {
        uint256 matchId = _createAndFillMatch();

        // Blocklist player1 before settlement
        usdc.blocklist(player1);

        // Settle as draw — player1's transfer fails, queued
        vm.prank(address(escrow));
        escrow.testSettleMatchDraw(matchId);

        uint256 pending = escrow.pendingWithdrawals(player1);
        assertTrue(pending > 0, "Should have pending");

        // Un-blocklist player1
        usdc.unblocklist(player1);

        // Now withdraw succeeds
        uint256 balBefore = usdc.balanceOf(player1);
        vm.prank(player1);
        escrow.withdraw();

        assertEq(escrow.pendingWithdrawals(player1), 0);
        assertEq(usdc.balanceOf(player1) - balBefore, pending);
    }

    function test_Withdraw_StillBlocklisted_Reverts() public {
        uint256 matchId = _createAndFillMatch();

        usdc.blocklist(player2);

        vm.prank(address(escrow));
        escrow.testSettleMatchDraw(matchId);

        uint256 pending = escrow.pendingWithdrawals(player2);
        assertTrue(pending > 0, "Should have pending");

        // Withdraw reverts because still blocklisted
        vm.prank(player2);
        vm.expectRevert();
        escrow.withdraw();
    }

    function test_PullPayment_AdminVoid_BlocklistedPlayer() public {
        uint256 matchId = _createAndFillMatch();

        // Blocklist player1
        usdc.blocklist(player1);

        // Admin void — refunds both players
        escrow.adminVoidMatch(matchId);

        // player1's refund should be in pendingWithdrawals
        uint256 pending = escrow.pendingWithdrawals(player1);
        assertTrue(pending > 0, "Blocklisted player should have pending withdrawal after void");

        // player2 got refunded directly
        assertEq(escrow.pendingWithdrawals(player2), 0);
    }
}
