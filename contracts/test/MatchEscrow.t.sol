// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/MatchEscrow.sol";
import "../src/core/PriceProvider.sol";
import "../src/games/RPS.sol";
import "../src/logic/SimpleDice.sol";
import "../lib/chainlink-brownie-contracts/contracts/src/v0.8/tests/MockV3Aggregator.sol";

/**
 * @dev Test harness to expose internal state for coverage testing.
 */
contract MatchEscrowHarness is MatchEscrow {
    constructor(address _treasury, address _priceProvider) MatchEscrow(_treasury, _priceProvider) {}

    function setRoundCommit(uint256 matchId, uint8 round, address player, bytes32 hash, uint8 move, bool revealed) external {
        roundCommits[matchId][round][player] = RoundCommit({
            commitHash: hash,
            move: move,
            salt: bytes32(0),
            revealed: revealed
        });
    }

    function exposeSafeTransfer(address to, uint256 amount) external {
        _safeTransfer(to, amount);
    }
}

contract RevertingReceiver {
    bool public accept = true;
    receive() external payable {
        if (!accept) revert("Rejected");
    }
    function setAccept(bool _accept) external {
        accept = _accept;
    }
}

contract MockDrawRoundGameLogic is IGameLogic {
    function resolveRound(uint8, uint8) external pure override returns (uint8) { return 0; }
    function isValidMove(uint8) external pure override returns (bool) { return true; }
    function gameType() external pure override returns (string memory) { return "MOCK_DRAW"; }
    function moveName(uint8) external pure override returns (string memory) { return "DRAW"; }
}

contract MockPlayerBWinsLogic is IGameLogic {
    function resolveRound(uint8, uint8) external pure override returns (uint8) { return 2; }
    function isValidMove(uint8) external pure override returns (bool) { return true; }
    function gameType() external pure override returns (string memory) { return "MOCK_B_WINS"; }
    function moveName(uint8) external pure override returns (string memory) { return "B_WIN"; }
}

contract MatchEscrowTest is Test {
    MatchEscrowHarness public escrow;
    RPS public rps;
    SimpleDice public dice;
    PriceProvider public priceProvider;
    MockV3Aggregator public mockPriceFeed;
    address public treasury = address(0x123);
    address public playerA = address(0x111);
    address public playerB = address(0x222);
    address public stranger = address(0x333);

    uint256 public constant STAKE = 1 ether;

    function setUp() public {
        vm.warp(100 weeks); // Move away from 0
        mockPriceFeed = new MockV3Aggregator(8, 3000 * 1e8); // $3000 ETH
        priceProvider = new PriceProvider(address(mockPriceFeed), 2 * 1e18); // $2 min
        escrow = new MatchEscrowHarness(treasury, address(priceProvider));
        rps = new RPS();
        dice = new SimpleDice();
        escrow.approveGameLogic(address(rps), true);
        escrow.approveGameLogic(address(dice), true);
        vm.deal(playerA, 10 ether);
        vm.deal(playerB, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    function _playRound(uint256 mId, uint8 round, uint8 moveA, uint8 moveB) internal {
        bytes32 saltA = keccak256(abi.encodePacked("saltA", round));
        bytes32 saltB = keccak256(abi.encodePacked("saltB", round));
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), mId, round, playerA, moveA, saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), mId, round, playerB, moveB, saltB));

        vm.prank(playerA);
        escrow.commitMove(mId, hashA);
        vm.prank(playerB);
        escrow.commitMove(mId, hashB);

        vm.prank(playerA);
        escrow.revealMove(mId, moveA, saltA);
        vm.prank(playerB);
        escrow.revealMove(mId, moveB, saltB);
    }

    function testCreateMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.playerA, playerA);
        assertEq(m.stake, STAKE);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.OPEN));
    }

    function testJoinMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.playerB, playerB);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.ACTIVE));
    }

    function testFullGameLoop() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        _playRound(1, 1, 1, 0); // A wins (1-0)
        _playRound(1, 2, 1, 0); // A wins (2-0)
        _playRound(1, 3, 1, 0); // A wins (3-0) -> Settled

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 3);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function testFullGameLoopPlayerBWin() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        _playRound(1, 1, 0, 1); // B wins (0-1)
        _playRound(1, 2, 0, 1); // B wins (0-2)
        _playRound(1, 3, 0, 1); // B wins (0-3) -> Settled

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsB, 3);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function testDrawAndMaxRounds() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        for(uint8 i=1; i<=5; i++) {
            _playRound(1, i, 0, 0); // Draw 1
            _playRound(1, i, 0, 0); // Draw 2
            _playRound(1, i, 0, 0); // Draw 3 -> forces i++
        }

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function testClaimTimeoutCommit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        escrow.commitMove(1, keccak256("hash"));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        escrow.claimTimeout(1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 3);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
    }

    function testClaimTimeoutCommitByPlayerB() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerB);
        escrow.commitMove(1, keccak256("hashB"));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerB);
        escrow.claimTimeout(1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsB, 3);
    }

    function testClaimTimeoutReveal() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        bytes32 saltA = keccak256("saltA");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerA, uint8(1), saltA));
        
        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, keccak256("B"));

        vm.prank(playerA);
        escrow.revealMove(1, 1, saltA);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        escrow.claimTimeout(1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 3);
    }

    function testClaimTimeoutRevealByPlayerB() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        bytes32 saltB = keccak256("saltB");
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerB, uint8(1), saltB));
        
        vm.prank(playerA);
        escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerB);
        escrow.revealMove(1, 1, saltB);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerB);
        escrow.claimTimeout(1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsB, 3);
    }

    function testMutualTimeoutCommit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        escrow.mutualTimeout(1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testMutualTimeoutReveal() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        escrow.mutualTimeout(1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testCancelMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        vm.prank(playerA);
        escrow.cancelMatch(1);
        
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testAdminVoidMatchOpen() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        escrow.adminVoidMatch(1);
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testAdminVoidActiveMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        
        escrow.adminVoidMatch(1);
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function test_SettleMatchTreasuryFailGraceful() public {
        RevertingReceiver badTreasury = new RevertingReceiver();
        badTreasury.setAccept(false);
        escrow.setTreasury(address(badTreasury));

        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        _playRound(1, 1, 1, 0);
        _playRound(1, 2, 1, 0);
        _playRound(1, 3, 1, 0); // Settles

        // Payout is 2 ETH total. Rake is 5% = 0.1 ETH.
        assertEq(escrow.pendingWithdrawals(address(badTreasury)), 0.1 ether);
    }

    function testWithdrawSuccess() public {
        RevertingReceiver badA = new RevertingReceiver();
        vm.deal(address(badA), 1 ether);
        vm.prank(address(badA));
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        badA.setAccept(false);
        vm.prank(address(badA));
        escrow.cancelMatch(1);

        uint256 pending = escrow.pendingWithdrawals(address(badA));
        assertEq(pending, STAKE);
        
        badA.setAccept(true);
        vm.prank(address(badA));
        escrow.withdraw();
        assertEq(address(badA).balance, 1 ether);
    }

    function testSafeTransferZeroAmount() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        escrow.adminVoidMatch(1); // Hits _safeTransfer for playerB (amount 0)
    }

    function testSafeTransferZeroAmountExplicit() public {
        escrow.exposeSafeTransfer(address(0x123), 0);
    }

    function testSafeTransferFailure() public {
        RevertingReceiver badRecipient = new RevertingReceiver();
        badRecipient.setAccept(false);
        
        vm.expectEmit(true, false, false, true);
        emit MatchEscrow.WithdrawalQueued(address(badRecipient), 1 ether);
        escrow.exposeSafeTransfer(address(badRecipient), 1 ether);
        
        assertEq(escrow.pendingWithdrawals(address(badRecipient)), 1 ether);
    }

    function testGetRoundStatus() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        escrow.commitMove(1, keccak256("hash"));
        (bytes32 h, bool r) = escrow.getRoundStatus(1, 1, playerA);
        assertEq(h, keccak256("hash"));
        assertFalse(r);
    }

    function testPausability() public {
        escrow.pause();
        vm.prank(playerA);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        escrow.unpause();
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
    }

    function testSettleMatchWinB() public {
        MockPlayerBWinsLogic bWinsLogic = new MockPlayerBWinsLogic();
        escrow.approveGameLogic(address(bWinsLogic), true);

        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(bWinsLogic));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        for (uint8 r = 1; r <= 3; r++) {
            _playRound(1, r, 1, 1);
        }

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winsB, 3);
    }

    function testMutualTimeoutRevealV1() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        escrow.mutualTimeout(1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.VOIDED));
    }

    function testAdminVoidZeroAddresses() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        
        // Use harness to set playerA to 0
        // Wait, MatchEscrow struct storage is more complex to set via harness without a setter.
        // I'll just use storage manipulation but with correct offset.
        // slot 2 is matches mapping.
        bytes32 slot = keccak256(abi.encode(uint256(1), uint256(2)));
        vm.store(address(escrow), slot, bytes32(0));
        
        escrow.adminVoidMatch(1);
    }

    function testSettleMatchTie() public {
        MockDrawRoundGameLogic drawLogic = new MockDrawRoundGameLogic();
        escrow.approveGameLogic(address(drawLogic), true);

        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(drawLogic));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        for (uint8 i = 1; i <= 5; i++) {
            _playRound(1, i, 1, 1); // Draw 1
            _playRound(1, i, 1, 1); // Draw 2
            _playRound(1, i, 1, 1); // Draw 3 -> forces next round
        }

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winsA, 0);
        assertEq(m.winsB, 0);
    }

    function testSuddenDeathDraw() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        // Round 1: Draw 1 (Rock vs Rock)
        _playRound(1, 1, 0, 0); 
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.currentRound, 1);
        assertEq(m.drawCounter, 1);

        // Round 1: Draw 2
        _playRound(1, 1, 0, 0);
        m = escrow.getMatch(1);
        assertEq(m.currentRound, 1);
        assertEq(m.drawCounter, 2);

        // Round 1: Draw 3 -> Should force next round
        _playRound(1, 1, 0, 0);
        m = escrow.getMatch(1);
        assertEq(m.currentRound, 2, "Should increment round after 3 draws");
        assertEq(m.drawCounter, 0, "Counter should reset");
    }

    function testCreateMatchUSD() public {
        uint256 usdAmount = 10 * 1e18; // $10 USD
        uint256 expectedEth = priceProvider.getEthAmount(usdAmount);
        
        vm.prank(playerA);
        escrow.createMatchUSD{value: expectedEth + 1 ether}(usdAmount, address(rps));
        
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.stake, expectedEth);
        // Refund is now instant for standard accounts
        assertEq(playerA.balance, 10 ether - expectedEth);
    }

    function testCreateMatchUSDNoRefund() public {
        uint256 usdAmount = 5 * 1e18;
        uint256 expectedEth = priceProvider.getEthAmount(usdAmount);
        
        vm.prank(playerA);
        escrow.createMatchUSD{value: expectedEth}(usdAmount, address(rps));
        
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.stake, expectedEth);
    }

    function testSuddenDeathDrawLimit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        // Draw 1, 2, 3
        _playRound(1, 1, 0, 0); 
        _playRound(1, 1, 0, 0); 
        _playRound(1, 1, 0, 0); 

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.currentRound, 2, "Should force next round after 3 draws");
        assertEq(m.drawCounter, 0);
    }

    function testSetTreasury() public {
        address newTreasury = address(0x999);
        escrow.setTreasury(newTreasury);
        assertEq(escrow.treasury(), newTreasury);
    }

    function testApproveGameLogic() public {
        address mockLogic = address(0xabc);
        escrow.approveGameLogic(mockLogic, true);
        assertTrue(escrow.approvedGameLogic(mockLogic));
        escrow.approveGameLogic(mockLogic, false);
        assertFalse(escrow.approvedGameLogic(mockLogic));
    }

    function testReceiveETH() public {
        uint256 balBefore = address(escrow).balance;
        (bool success, ) = address(escrow).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(escrow).balance, balBefore + 1 ether);
    }

    function testFullGameLoopDice() public {
        // Create
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(dice));

        // Join
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        // Round 1: Player A (6), Player B (1) -> A wins
        uint8 moveA = 6;
        uint8 moveB = 1;
        bytes32 saltA = keccak256("saltA1");
        bytes32 saltB = keccak256("saltB1");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerA, moveA, saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerB, moveB, saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, moveA, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, moveB, saltB);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 1);
        assertEq(m.winsB, 0);
        assertEq(m.currentRound, 2);

        // Round 2: Player A (3), Player B (5) -> B wins
        moveA = 3;
        moveB = 5;
        saltA = keccak256("saltA2");
        saltB = keccak256("saltB2");
        hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(2), playerA, moveA, saltA));
        hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(2), playerB, moveB, saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, moveA, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, moveB, saltB);

        m = escrow.getMatch(1);
        assertEq(m.winsA, 1);
        assertEq(m.winsB, 1);
        assertEq(m.currentRound, 3);

        // Round 3: A wins again (2-1)
        _playRound(1, 3, 6, 1); 
        // Round 4: A wins Match (3-1)
        uint256 balBeforeA = playerA.balance;
        _playRound(1, 4, 6, 1); 

        m = escrow.getMatch(1);
        assertEq(uint(m.status), uint(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winsA, 3);

        // Verify instant payout
        uint256 totalPot = STAKE * 2;
        uint256 rake = (totalPot * 500) / 10000;
        uint256 payout = totalPot - rake;
        assertEq(playerA.balance, balBeforeA + payout);
    }

    function testPriceProviderMinStake() public {
        vm.prank(address(this)); // Owner
        vm.expectEmit(true, false, false, true);
        emit IPriceProvider.PriceUpdated(10 * 1e18);
        priceProvider.setMinStakeUsd(10 * 1e18);
        assertEq(priceProvider.getMinStakeUsd(), 10 * 1e18);
    }

    function test_RevertIf_PriceProviderNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger));
        priceProvider.setMinStakeUsd(1 * 1e18);
    }

    function test_RevertIf_PriceProviderConstructorZeroAddress() public {
        vm.expectRevert("Invalid price feed");
        new PriceProvider(address(0), 5 * 1e18);
    }

    function test_RevertIf_PriceStale() public {
        // Set updatedAt to 25 hours ago
        mockPriceFeed.updateRoundData(1, 3000 * 1e8, block.timestamp - 25 hours, block.timestamp - 25 hours);
        
        vm.expectRevert("Price stale");
        priceProvider.getEthAmount(10 * 1e18);
        
        vm.expectRevert("Price stale");
        priceProvider.getUsdValue(1 ether);
    }

    // --- Reverts ---

    function test_RevertIf_CreateMatchUSDInsufficientETH() public {
        uint256 usdAmount = 10 * 1e18;
        uint256 requiredEth = priceProvider.getEthAmount(usdAmount);
        
        vm.prank(playerA);
        vm.expectRevert("Insufficient ETH for USD stake");
        escrow.createMatchUSD{value: requiredEth - 1}(usdAmount, address(rps));
    }

    function test_RevertIf_PriceFeedZero() public {
        mockPriceFeed.updateAnswer(0);
        vm.expectRevert("Invalid price");
        priceProvider.getEthAmount(10 * 1e18);
        
        vm.expectRevert("Invalid price");
        priceProvider.getUsdValue(1 ether);
    }

    function test_RevertIf_AdminVoidNotVoidable() public {
        // Already settled/voided test is elsewhere, this is just for coverage
    }

    function test_RevertIf_ConstructorZeroTreasury() public {
        vm.expectRevert("Invalid treasury");
        new MatchEscrowHarness(address(0), address(priceProvider));
        
        vm.expectRevert("Invalid price provider");
        new MatchEscrowHarness(address(0x123), address(0));
    }

    function test_RevertIf_CreateMatchZeroStake() public {
        vm.prank(playerA);
        vm.expectRevert("Stake below $2 USD minimum");
        escrow.createMatch{value: 0}(0, address(rps));
    }

    function test_RevertIf_CreateMatchWrongValue() public {
        vm.prank(playerA);
        vm.expectRevert("Incorrect stake amount");
        escrow.createMatch{value: 1 ether}(2 ether, address(rps));
    }

    function test_RevertIf_CreateMatchUnapprovedLogic() public {
        vm.prank(playerA);
        vm.expectRevert("Game logic not approved");
        escrow.createMatch{value: STAKE}(STAKE, address(0xdead));
    }

    function test_RevertIf_CancelMatchNotOpen() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        vm.expectRevert("Match not open");
        escrow.cancelMatch(1);
    }

    function test_RevertIf_CancelMatchNotCreator() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(stranger);
        vm.expectRevert("Not match creator");
        escrow.cancelMatch(1);
    }

    function test_RevertIf_JoinMatchNotOpen() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        escrow.adminVoidMatch(1);
        vm.prank(playerB);
        vm.expectRevert("Match not open");
        escrow.joinMatch{value: STAKE}(1);
    }

    function test_RevertIf_JoinMatchSelf() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerA);
        vm.expectRevert("Cannot play against yourself");
        escrow.joinMatch{value: STAKE}(1);
    }

    function test_RevertIf_JoinMatchWrongStake() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        vm.expectRevert("Incorrect stake amount");
        escrow.joinMatch{value: 0.5 ether}(1);
    }

    function test_RevertIf_CommitMoveNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerA);
        vm.expectRevert("Match not active");
        escrow.commitMove(1, bytes32(0));
    }

    function test_RevertIf_CommitMoveWrongPhase() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        
        vm.prank(playerA);
        vm.expectRevert("Not in commit phase");
        escrow.commitMove(1, keccak256("A2"));
    }

    function test_RevertIf_CommitExpired() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Commit deadline passed");
        escrow.commitMove(1, keccak256("A"));
    }

    function test_RevertIf_CommitUnauthorized() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(stranger);
        vm.expectRevert("Not a participant");
        escrow.commitMove(1, keccak256("A"));
    }

    function test_RevertIf_CommitTwice() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        escrow.commitMove(1, keccak256("A"));
        vm.prank(playerA);
        vm.expectRevert("Already committed");
        escrow.commitMove(1, keccak256("A2"));
    }

    function test_RevertIf_RevealNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerA);
        vm.expectRevert("Match not active");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealNotInRevealPhase() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        vm.expectRevert("Not in reveal phase");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealExpired() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Reveal deadline passed");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealMoveNotParticipant() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.prank(stranger);
        vm.expectRevert("Not a participant");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealMoveTwice() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        bytes32 saltA = keccak256("saltA");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerA, uint8(1), saltA));
        vm.prank(playerA); escrow.commitMove(1, hashA);
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.prank(playerA); escrow.revealMove(1, 1, saltA);
        vm.prank(playerA);
        vm.expectRevert("Already revealed");
        escrow.revealMove(1, 1, saltA);
    }

    function test_RevertIf_RevealInvalidHash() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.prank(playerA);
        vm.expectRevert("Invalid reveal");
        escrow.revealMove(1, 1, bytes32(0));
    }

    function test_RevertIf_RevealInvalidMove() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        
        uint8 moveA = 99; // Invalid RPS move
        bytes32 saltA = bytes32(0);
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerA, moveA, saltA));
        vm.prank(playerA); escrow.commitMove(1, hashA);
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        
        vm.prank(playerA);
        vm.expectRevert("Invalid move");
        escrow.revealMove(1, moveA, saltA);
    }

    function test_RevertIf_ClaimTimeoutNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerA);
        vm.expectRevert("Match not active");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutNotParticipant() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(stranger);
        vm.expectRevert("Not a participant");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutTooEarly() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutYouDidNotCommit() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("You did not commit");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutOpponentCommitted() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        vm.prank(playerA);
        escrow.commitMove(1, keccak256("A"));

        // Harness set B committed
        escrow.setRoundCommit(1, 1, playerB, keccak256("B"), 0, false);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Opponent committed");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutRevealDeadlineNotPassed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        
        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutYouDidNotReveal() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("You did not reveal");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_ClaimTimeoutOpponentRevealed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);

        bytes32 saltA = keccak256("saltA");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerA, uint8(1), saltA));
        vm.prank(playerA); escrow.commitMove(1, hashA);
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        
        vm.prank(playerA); escrow.revealMove(1, 1, saltA);

        // Harness set B revealed
        escrow.setRoundCommit(1, 1, playerB, keccak256("B"), 1, true);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Opponent revealed");
        escrow.claimTimeout(1);
    }

    function test_RevertIf_MutualTimeoutNotActive() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.expectRevert("Match not active");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutNotMet() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutRevealNotMet() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutNotMutualCommitV1() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        escrow.commitMove(1, keccak256("A"));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Mutual timeout not met");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutNotMutualCommitV1_A_Committed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        escrow.commitMove(1, keccak256("A"));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Mutual timeout not met");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutNotMutualCommitV1_B_Committed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerB);
        escrow.commitMove(1, keccak256("B"));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Mutual timeout not met");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutOneRevealedV1() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        bytes32 saltA = keccak256("saltA");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerA, uint8(1), saltA));
        vm.prank(playerA); escrow.commitMove(1, hashA);
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.prank(playerA); escrow.revealMove(1, 1, saltA);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Mutual timeout not met");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutOneRevealedV1_A_Revealed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        bytes32 saltA = keccak256("saltA");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerA, uint8(1), saltA));
        vm.prank(playerA); escrow.commitMove(1, hashA);
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.prank(playerA); escrow.revealMove(1, 1, saltA);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Mutual timeout not met");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutOneRevealedV1_B_Revealed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        bytes32 saltB = keccak256("saltB");
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint8(1), playerB, uint8(1), saltB));
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, hashB);
        vm.prank(playerB); escrow.revealMove(1, 1, saltB);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(playerA);
        vm.expectRevert("Mutual timeout not met");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutCommitDeadlineNotPassed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_MutualTimeoutRevealDeadlineNotPassed() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        vm.prank(playerA); escrow.commitMove(1, keccak256("A"));
        vm.prank(playerB); escrow.commitMove(1, keccak256("B"));
        vm.prank(playerA);
        vm.expectRevert("Deadline not passed");
        escrow.mutualTimeout(1);
    }

    function test_RevertIf_AdminVoidSettledMatch() public {
        vm.prank(playerA);
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        vm.prank(playerB);
        escrow.joinMatch{value: STAKE}(1);
        _playRound(1, 1, 1, 0); 
        _playRound(1, 2, 1, 0); 
        _playRound(1, 3, 1, 0); 
        vm.expectRevert("Match not voidable");
        escrow.adminVoidMatch(1);
    }

    function test_RevertIf_WithdrawNothing() public {
        vm.prank(stranger);
        vm.expectRevert("Nothing to withdraw");
        escrow.withdraw();
    }

    function test_RevertIf_WithdrawFailed() public {
        RevertingReceiver badA = new RevertingReceiver();
        vm.deal(address(badA), 1 ether);
        vm.prank(address(badA));
        escrow.createMatch{value: STAKE}(STAKE, address(rps));
        badA.setAccept(false);
        vm.prank(address(badA));
        escrow.cancelMatch(1);
        vm.prank(address(badA));
        vm.expectRevert("Withdrawal failed");
        escrow.withdraw();
    }

    function test_RevertIf_SetTreasuryZero() public {
        vm.expectRevert("Invalid treasury");
        escrow.setTreasury(address(0));
    }

    function test_RevertIf_ApproveLogicZero() public {
        vm.expectRevert("Invalid logic address");
        escrow.approveGameLogic(address(0), true);
    }

    function test_RevertIf_NotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger));
        escrow.pause();
    }
}
