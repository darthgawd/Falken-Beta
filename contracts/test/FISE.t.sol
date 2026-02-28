// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/FiseEscrow.sol";
import "../src/core/LogicRegistry.sol";
import "../src/core/PriceProvider.sol";
import "../lib/chainlink-brownie-contracts/contracts/src/v0.8/tests/MockV3Aggregator.sol";

contract FISETest is Test {
    FiseEscrow public escrow;
    LogicRegistry public registry;
    PriceProvider public priceProvider;
    MockV3Aggregator public mockOracle;

    address public owner = address(this);
    address public treasury = address(0x123);
    address public referee = address(0x456);
    address public playerA = address(0xAAA);
    address public playerB = address(0xBBB);
    address public developer = address(0x789);

    bytes32 public logicId;

    // Events for testing
    event RoundStarted(uint256 indexed matchId, uint8 round);

    function setUp() public {
        mockOracle = new MockV3Aggregator(8, 2500 * 1e8);
        priceProvider = new PriceProvider(address(mockOracle), 2 ether);
        registry = new LogicRegistry();
        
        escrow = new FiseEscrow(
            treasury,
            address(priceProvider),
            address(registry),
            referee
        );

        logicId = registry.registerLogic("QmSFAH26ZaFKDAyja8YAbq9ndwousixPZwMTTWkeyfZnGa", developer);
    }

    function test_RegisterLogic_OnlyOwner() public {
        vm.prank(playerA);
        vm.expectRevert();
        registry.registerLogic("QmAnotherOne", developer);
    }

    function test_RegisterLogic_DuplicateReverts() public {
        vm.expectRevert("Logic already registered");
        registry.registerLogic("QmSFAH26ZaFKDAyja8YAbq9ndwousixPZwMTTWkeyfZnGa", developer);
    }

    function test_SetVerificationStatus() public {
        registry.setVerificationStatus(logicId, true);
        (,,bool isVerified,,) = registry.registry(logicId);
        assertTrue(isVerified);
    }

    function test_SetReferee_OnlyOwner() public {
        address newRef = address(0x999);
        escrow.setReferee(newRef);
        assertEq(escrow.referee(), newRef);

        vm.prank(playerA);
        vm.expectRevert(); 
        escrow.setReferee(playerA);
    }

    function test_CreateFiseMatch() public {
        vm.deal(playerA, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        assertEq(escrow.fiseMatches(1), logicId);
    }

    function test_SettleFiseMatch_RoyaltySplit() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);

        uint256 initialTreasury = treasury.balance;
        uint256 initialDeveloper = developer.balance;
        uint256 initialPlayerA = playerA.balance;

        vm.prank(referee);
        escrow.settleFiseMatch(1, playerA);

        assertEq(playerA.balance, initialPlayerA + 1.9 ether);
        assertEq(treasury.balance, initialTreasury + 0.06 ether);
        assertEq(developer.balance, initialDeveloper + 0.04 ether);
    }

    function test_SettleFiseMatch_Draw() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);

        uint256 initialTreasury = treasury.balance;
        uint256 initialDeveloper = developer.balance;
        uint256 initialPlayerA = playerA.balance;
        uint256 initialPlayerB = playerB.balance;

        vm.prank(referee);
        escrow.settleFiseMatch(1, address(0));

        // Draw: split pot minus rake (5% = 0.1 ETH, so 1.9 ETH remaining, 0.95 each)
        assertEq(playerA.balance, initialPlayerA + 0.95 ether);
        assertEq(playerB.balance, initialPlayerB + 0.95 ether);
        assertEq(treasury.balance, initialTreasury + 0.06 ether); // 3%
        assertEq(developer.balance, initialDeveloper + 0.04 ether); // 2%
    }

    function test_RevertIf_NonRefereeSettles() public {
        vm.prank(playerA);
        vm.expectRevert("Only Referee can call");
        escrow.settleFiseMatch(1, playerA);
    }

    function test_RevertIf_InvalidWinner() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);

        vm.prank(referee);
        vm.expectRevert("Invalid winner");
        escrow.settleFiseMatch(1, address(0xDEAD));
    }

    function test_RecordVolume() public {
        registry.recordVolume(logicId, 5 ether);
        (,,,,uint256 volume) = registry.registry(logicId);
        assertEq(volume, 5 ether);
    }

    // --- Additional Branch Coverage Tests ---

    function test_Constructor_ZeroLogicRegistry_Reverts() public {
        vm.expectRevert("Invalid registry");
        new FiseEscrow(
            treasury,
            address(priceProvider),
            address(0),
            referee
        );
    }

    function test_Constructor_ZeroReferee_Reverts() public {
        vm.expectRevert("Invalid referee");
        new FiseEscrow(
            treasury,
            address(priceProvider),
            address(registry),
            address(0)
        );
    }

    function test_SetReferee_Success_VerifiedBySettle() public {
        address newReferee = address(0x999);
        
        escrow.setReferee(newReferee);
        
        // Verify new referee works by settling a match
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);
        
        vm.prank(newReferee);
        escrow.settleFiseMatch(1, playerA);
        
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint256(m.status), uint256(MatchEscrow.MatchStatus.SETTLED));
    }

    function test_SetVerificationStatus_TrueThenFalse() public {
        // Set to true
        registry.setVerificationStatus(logicId, true);
        (,,bool isVerified,,) = registry.registry(logicId);
        assertTrue(isVerified);
        
        // Set back to false
        registry.setVerificationStatus(logicId, false);
        (,,isVerified,,) = registry.registry(logicId);
        assertFalse(isVerified);
    }

    function test_GetRegistryCount() public {
        uint256 countBefore = registry.getRegistryCount();
        
        registry.registerLogic("QmNewTestHash", developer);
        
        uint256 countAfter = registry.getRegistryCount();
        assertEq(countAfter, countBefore + 1);
    }

    function test_RecordVolume_ThroughSettlement() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);

        (,,,,uint256 volumeBefore) = registry.registry(logicId);
        
        vm.prank(referee);
        escrow.settleFiseMatch(1, playerA);
        
        (,,,,uint256 volumeAfter) = registry.registry(logicId);
        assertEq(volumeAfter, volumeBefore + 2 ether);
    }

    // --- Additional Branch Coverage Tests ---

    function test_SetReferee_ZeroAddress_Reverts() public {
        vm.expectRevert("Invalid referee");
        escrow.setReferee(address(0));
    }

    function test_CreateFiseMatch_WrongStake_Reverts() public {
        vm.deal(playerA, 1 ether);
        vm.prank(playerA);
        vm.expectRevert("Incorrect stake amount");
        escrow.createFiseMatch{value: 0.5 ether}(1 ether, logicId);
    }

    function test_CreateFiseMatch_UnregisteredLogic_Reverts() public {
        vm.deal(playerA, 1 ether);
        vm.prank(playerA);
        bytes32 fakeLogicId = keccak256("fake");
        vm.expectRevert("Logic ID not registered");
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, fakeLogicId);
    }

    function test_CreateFiseMatch_BelowMinimum_Reverts() public {
        // Price is $2500, min $2 = 0.0008 ETH
        // 0.0001 ETH = $0.25 (Too low)
        uint256 tinyStake = 0.0001 ether;
        vm.deal(playerA, 1 ether);
        vm.prank(playerA);
        vm.expectRevert("Stake below minimum");
        escrow.createFiseMatch{value: tinyStake}(tinyStake, logicId);
    }

    function test_SettleFiseMatch_NotActive_Reverts() public {
        // Try to settle match that doesn't exist
        vm.prank(referee);
        vm.expectRevert("Match not active");
        escrow.settleFiseMatch(999, playerA);
    }

    function test_SettleFiseMatch_NotFiseMatch_Reverts() public {
        // Create a regular match (not FISE)
        MockGameLogic mockLogic = new MockGameLogic();
        escrow.approveGameLogic(address(mockLogic), true);
        
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createMatch{value: 1 ether}(1 ether, address(mockLogic));
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);
        
        // Try to settle as FISE match
        vm.prank(referee);
        vm.expectRevert("Not a FISE match");
        escrow.settleFiseMatch(1, playerA);
    }

    function test_SetVerificationStatus_LogicNotFound_Reverts() public {
        bytes32 fakeLogicId = keccak256("nonexistent");
        vm.expectRevert("Logic not found");
        registry.setVerificationStatus(fakeLogicId, true);
    }

    // ============================================
    // MULTI-ROUND FISE TESTS
    // ============================================

    // Helper to commit and reveal for a round
    function _commitAndReveal(uint256 matchId, address playerA_, address playerB_) internal {
        bytes32 saltA = keccak256(abi.encodePacked("salt", matchId, playerA_));
        bytes32 saltB = keccak256(abi.encodePacked("salt", matchId, playerB_));
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(1), playerA_, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(1), playerB_, uint256(2), saltB));

        vm.prank(playerA_);
        escrow.commitMove(matchId, hashA);
        vm.prank(playerB_);
        escrow.commitMove(matchId, hashB);

        vm.prank(playerA_);
        escrow.revealMove(matchId, 1, saltA);
        vm.prank(playerB_);
        escrow.revealMove(matchId, 2, saltB);
    }

    function _commitAndRevealForRound(uint256 matchId, uint8 round, address playerA_, address playerB_) internal {
        bytes32 saltA = keccak256(abi.encodePacked("salt", matchId, round, playerA_));
        bytes32 saltB = keccak256(abi.encodePacked("salt", matchId, round, playerB_));
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(round), playerA_, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(round), playerB_, uint256(2), saltB));

        vm.prank(playerA_);
        escrow.commitMove(matchId, hashA);
        vm.prank(playerB_);
        escrow.commitMove(matchId, hashB);

        vm.prank(playerA_);
        escrow.revealMove(matchId, 1, saltA);
        vm.prank(playerB_);
        escrow.revealMove(matchId, 2, saltB);
    }

    // Overload with replayIndex for unique salts when replaying the same round (draws)
    function _commitAndRevealForRound(uint256 matchId, uint8 round, address playerA_, address playerB_, uint256 replayIndex) internal {
        bytes32 saltA = keccak256(abi.encodePacked("salt", matchId, round, playerA_, replayIndex));
        bytes32 saltB = keccak256(abi.encodePacked("salt", matchId, round, playerB_, replayIndex));
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(round), playerA_, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), matchId, uint256(round), playerB_, uint256(2), saltB));

        vm.prank(playerA_);
        escrow.commitMove(matchId, hashA);
        vm.prank(playerB_);
        escrow.commitMove(matchId, hashB);

        vm.prank(playerA_);
        escrow.revealMove(matchId, 1, saltA);
        vm.prank(playerB_);
        escrow.revealMove(matchId, 2, saltB);
    }

    function test_ResolveFiseRound_PlayerAWins() public {
        // Setup: Create and join match
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // Commit and reveal to get to REVEAL phase
        _commitAndReveal(1, playerA, playerB);

        // Resolve round 1 - Player A wins
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // 1 = Player A wins

        // Check state
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 1);
        assertEq(m.winsB, 0);
        assertEq(m.currentRound, 2); // Advanced to next round
        assertEq(uint256(m.phase), uint256(MatchEscrow.Phase.COMMIT)); // Reset to commit
    }

    function test_ResolveFiseRound_PlayerBWins() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        _commitAndReveal(1, playerA, playerB);

        vm.prank(referee);
        escrow.resolveFiseRound(1, 2); // 2 = Player B wins

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 0);
        assertEq(m.winsB, 1);
        assertEq(m.currentRound, 2);
    }

    function test_ResolveFiseRound_Draw() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        _commitAndReveal(1, playerA, playerB);

        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // 0 = Draw

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 0);
        assertEq(m.winsB, 0);
        assertEq(m.drawCounter, 1);
        assertEq(m.currentRound, 1); // Stays on same round
    }

    function test_ResolveFiseRound_MultipleRoundsToSettlement() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // Round 1: A wins
        _commitAndRevealForRound(1, 1, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);

        // Round 2: A wins again
        _commitAndRevealForRound(1, 2, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);

        // Round 3: A wins - should auto-settle (first to 3)
        _commitAndRevealForRound(1, 3, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsA, 3);
        assertEq(uint256(m.status), uint256(MatchEscrow.MatchStatus.SETTLED));
    }

    function test_ResolveFiseRound_PlayerBWinsMatch() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // B wins 3 rounds
        _commitAndRevealForRound(1, 1, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2);
        
        _commitAndRevealForRound(1, 2, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2);
        
        _commitAndRevealForRound(1, 3, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.winsB, 3);
        assertEq(uint256(m.status), uint256(MatchEscrow.MatchStatus.SETTLED));
    }

    function test_ResolveFiseRound_DrawLimitAdvancesRound() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // 3 consecutive draws should advance round
        // Use replayIndex to ensure unique salts for same round replays
        _commitAndRevealForRound(1, 1, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        
        _commitAndRevealForRound(1, 1, playerA, playerB, 1); // Same round, different salt
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        
        _commitAndRevealForRound(1, 1, playerA, playerB, 2); // Same round, different salt
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // 3rd draw - should advance

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.currentRound, 2);
        assertEq(m.drawCounter, 0); // Reset after advancing
    }

    function test_ResolveFiseRound_MaxRoundsSettlement() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // Play to max rounds (5) with no winner (alternating wins, then draws)
        // A wins round 1, B wins round 2, A wins round 3, B wins round 4
        // At end of round 4: A=2, B=2, currentRound=5
        _commitAndRevealForRound(1, 1, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // Round 1: A wins
        
        _commitAndRevealForRound(1, 2, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2); // Round 2: B wins
        
        _commitAndRevealForRound(1, 3, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // Round 3: A wins
        
        _commitAndRevealForRound(1, 4, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2); // Round 4: B wins
        
        // Round 5: 3 draws to trigger settlement at max rounds
        _commitAndRevealForRound(1, 5, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // Draw 1
        _commitAndRevealForRound(1, 5, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // Draw 2
        _commitAndRevealForRound(1, 5, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // Draw 3 - settles

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint256(m.status), uint256(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winsA, 2);
        assertEq(m.winsB, 2);
        // Draw: split pot minus rake (5% = 0.01 ETH, so 0.19 ETH remaining, 0.095 each)
    }

    function test_ResolveFiseRound_MaxRoundsWithWinner() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // A wins rounds 1, 2; B wins round 3; A wins round 4; A wins round 5
        _commitAndRevealForRound(1, 1, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // Round 1: A
        
        _commitAndRevealForRound(1, 2, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // Round 2: A (A=2, B=0)
        
        _commitAndRevealForRound(1, 3, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2); // Round 3: B (A=2, B=1)
        
        _commitAndRevealForRound(1, 4, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // Round 4: A (A=3, B=1)
        // Should have settled at round 4 (first to 3)

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint256(m.status), uint256(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winsA, 3);
    }

    function test_ResolveFiseRound_AutoSettlesOnDrawAtMaxRounds() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // Get to round 5 with tied score
        _commitAndRevealForRound(1, 1, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // Round 1: A
        
        _commitAndRevealForRound(1, 2, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1); // Round 2: A (A=2, B=0)
        
        _commitAndRevealForRound(1, 3, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2); // Round 3: B (A=2, B=1)
        
        _commitAndRevealForRound(1, 4, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 2); // Round 4: B (A=2, B=2)
        
        // Round 5: 3 draws at max rounds triggers settlement
        _commitAndRevealForRound(1, 5, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // Draw 1
        _commitAndRevealForRound(1, 5, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // Draw 2
        _commitAndRevealForRound(1, 5, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // Draw 3 - settles at max rounds

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint256(m.status), uint256(MatchEscrow.MatchStatus.SETTLED));
        assertEq(m.winsA, 2);
        assertEq(m.winsB, 2);
    }

    function test_ResolveFiseRound_EmitsRoundStarted() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        _commitAndReveal(1, playerA, playerB);

        // Expect RoundStarted event for round 2
        vm.expectEmit(true, false, false, true);
        emit RoundStarted(1, 2);

        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);
    }

    function test_ResolveFiseRound_EmitsRoundResolved() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        _commitAndReveal(1, playerA, playerB);

        vm.expectEmit(true, false, false, true);
        emit MatchEscrow.RoundResolved(1, 1, 1); // matchId, round, winner

        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);
    }

    function test_ResolveFiseRound_RevertIf_NotActive() public {
        vm.prank(referee);
        vm.expectRevert("Match not active");
        escrow.resolveFiseRound(999, 1);
    }

    function test_ResolveFiseRound_RevertIf_NotRevealPhase() public {
        // Create and join match (ACTIVE but in COMMIT phase, not REVEAL)
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // Match is now ACTIVE but in COMMIT phase
        vm.prank(referee);
        vm.expectRevert("Not in reveal phase");
        escrow.resolveFiseRound(1, 1);
    }

    function test_ResolveFiseRound_RevertIf_NotFiseMatch() public {
        MockGameLogic mockLogic = new MockGameLogic();
        escrow.approveGameLogic(address(mockLogic), true);
        
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createMatch{value: 0.1 ether}(0.1 ether, address(mockLogic));
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // Commit and reveal to get to REVEAL phase
        bytes32 saltA = keccak256(abi.encodePacked("salt", playerA));
        bytes32 saltB = keccak256(abi.encodePacked("salt", playerB));
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(2), saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        vm.prank(playerA);
        escrow.revealMove(1, 1, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, 2, saltB);

        vm.prank(referee);
        vm.expectRevert("Not a FISE match");
        escrow.resolveFiseRound(1, 1);
    }

    function test_ResolveFiseRound_RevertIf_InvalidWinner() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        _commitAndReveal(1, playerA, playerB);

        vm.prank(referee);
        vm.expectRevert("Invalid winner");
        escrow.resolveFiseRound(1, 3); // 3 is invalid
    }

    function test_ResolveFiseRound_RevertIf_NotReferee() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        _commitAndReveal(1, playerA, playerB);

        vm.prank(playerA);
        vm.expectRevert("Only Referee can call");
        escrow.resolveFiseRound(1, 1);
    }

    function test_AutoSettlement_PayoutsCorrect() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);

        uint256 initialTreasury = treasury.balance;
        uint256 initialDeveloper = developer.balance;
        uint256 initialPlayerA = playerA.balance;

        // A wins 3 rounds
        _commitAndRevealForRound(1, 1, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);
        
        _commitAndRevealForRound(1, 2, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);
        
        _commitAndRevealForRound(1, 3, playerA, playerB);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);

        // Verify payouts (same as settleFiseMatch)
        assertEq(playerA.balance, initialPlayerA + 1.9 ether);
        assertEq(treasury.balance, initialTreasury + 0.06 ether);
        assertEq(developer.balance, initialDeveloper + 0.04 ether);
    }

    function test_AutoSettlement_DrawPayouts() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);

        uint256 initialPlayerA = playerA.balance;
        uint256 initialPlayerB = playerB.balance;

        // Play 5 rounds, all draws
        // Each round allows up to 3 draws before advancing
        // Round 1: 3 draws → advances to round 2
        _commitAndRevealForRound(1, 1, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 1, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 1, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // 3rd draw, advances to round 2
        
        // Round 2: 3 draws → advances to round 3
        _commitAndRevealForRound(1, 2, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 2, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 2, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // 3rd draw, advances to round 3
        
        // Round 3: 3 draws → advances to round 4
        _commitAndRevealForRound(1, 3, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 3, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 3, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // 3rd draw, advances to round 4
        
        // Round 4: 3 draws → advances to round 5
        _commitAndRevealForRound(1, 4, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 4, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 4, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // 3rd draw, advances to round 5
        
        // Round 5: 3 draws → settles (max rounds reached)
        _commitAndRevealForRound(1, 5, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 5, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        _commitAndRevealForRound(1, 5, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0); // 3rd draw on round 5, settles

        // Draw: split pot minus rake (5% = 0.1 ETH, so 1.9 ETH remaining, 0.95 each)
        assertEq(playerA.balance, initialPlayerA + 0.95 ether);
        assertEq(playerB.balance, initialPlayerB + 0.95 ether);
    }

    function test_DrawCounter_ResetsOnWin() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // 2 draws with unique salts using replayIndex
        _commitAndRevealForRound(1, 1, playerA, playerB, 0);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);
        
        _commitAndRevealForRound(1, 1, playerA, playerB, 1);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 0);

        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(m.drawCounter, 2);

        // A wins - draw counter resets (still round 1, use replayIndex 2)
        _commitAndRevealForRound(1, 1, playerA, playerB, 2);
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);

        m = escrow.getMatch(1);
        assertEq(m.drawCounter, 0);
        assertEq(m.winsA, 1);
    }

    function test_FiseWinsRequired_Constant() public view {
        assertEq(escrow.FISE_WINS_REQUIRED(), 3);
    }

    function test_SettleFiseMatch_LegacyStillWorks() public {
        // Legacy single-round settlement should still work
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 1 ether}(1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 1 ether}(1);

        uint256 initialPlayerA = playerA.balance;

        // Use legacy settleFiseMatch
        vm.prank(referee);
        escrow.settleFiseMatch(1, playerA);

        assertEq(playerA.balance, initialPlayerA + 1.9 ether);
        
        MatchEscrow.Match memory m = escrow.getMatch(1);
        assertEq(uint256(m.status), uint256(MatchEscrow.MatchStatus.SETTLED));
    }

    function test_ResolveFiseRound_CleansUpRoundCommits() public {
        vm.deal(playerA, 1 ether);
        vm.deal(playerB, 1 ether);
        vm.prank(playerA);
        escrow.createFiseMatch{value: 0.1 ether}(0.1 ether, logicId);
        vm.prank(playerB);
        escrow.joinMatch{value: 0.1 ether}(1);

        // Commit moves
        bytes32 saltA = keccak256("saltA");
        bytes32 saltB = keccak256("saltB");
        bytes32 hashA = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerA, uint256(1), saltA));
        bytes32 hashB = keccak256(abi.encodePacked("FALKEN_V1", address(escrow), uint256(1), uint256(1), playerB, uint256(2), saltB));

        vm.prank(playerA);
        escrow.commitMove(1, hashA);
        vm.prank(playerB);
        escrow.commitMove(1, hashB);

        // Reveal moves
        vm.prank(playerA);
        escrow.revealMove(1, 1, saltA);
        vm.prank(playerB);
        escrow.revealMove(1, 2, saltB);

        // Resolve round
        vm.prank(referee);
        escrow.resolveFiseRound(1, 1);

        // Round commits should be cleaned up (can't reveal again)
        vm.prank(playerA);
        vm.expectRevert(); // Should fail since round was cleaned up
        escrow.revealMove(1, 1, saltA);
    }
}


// Helper contract that rejects ETH transfers
contract RejectETH {
    receive() external payable {
        revert("ETH rejected");
    }
    
    fallback() external payable {
        revert("ETH rejected");
    }
}

// Mock game logic for testing non-FISE match settlement revert
contract MockGameLogic is IGameLogic {
    function resolveRound(uint8 move1, uint8 move2) external pure returns (uint8) {
        if (move1 == move2) return 0;
        return move1 > move2 ? 1 : 2;
    }
    function moveName(uint8) external pure returns (string memory) { return "MOVE"; }
    function gameType() external pure returns (string memory) { return "MOCK"; }
    function isValidMove(uint8) external pure returns (bool) { return true; }
    function winsRequired() external pure returns (uint8) { return 3; }
}
