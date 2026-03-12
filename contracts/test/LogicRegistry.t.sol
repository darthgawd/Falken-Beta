// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/LogicRegistry.sol";

contract LogicRegistryTest is Test {
    LogicRegistry registry;
    address owner = address(this);
    address developer = address(0x123);
    address escrow = address(0x456);
    
    string constant IPFS_CID = "QmTest123";
    string constant IPFS_CID_2 = "QmTest456";
    bytes32 logicId;
    bytes32 logicId2;

    function setUp() public {
        registry = new LogicRegistry();
        logicId = keccak256(abi.encodePacked(IPFS_CID));
        logicId2 = keccak256(abi.encodePacked(IPFS_CID_2));
    }

    // ==================== CONSTRUCTOR TESTS ====================

    function test_Constructor() public view {
        assertEq(registry.getRegistryCount(), 0);
    }

    // ==================== REGISTRATION TESTS ====================

    function test_RegisterLogic() public {
        bytes32 id = registry.registerLogic(IPFS_CID, developer, true, 4);
        
        assertEq(id, logicId);
        assertEq(registry.getRegistryCount(), 1);
        
        LogicRegistry.GameLogic memory game = registry.getGameLogic(id);
        assertEq(game.ipfsCid, IPFS_CID);
        assertEq(game.developer, developer);
        assertEq(game.isVerified, false);
        assertEq(game.bettingEnabled, true);
        assertEq(game.maxStreets, 4);
        assertEq(game.totalVolume, 0);
        assertTrue(game.createdAt > 0);
    }

    function test_RegisterSimpleGame() public {
        bytes32 id = registry.registerSimpleGame(IPFS_CID, developer);
        
        LogicRegistry.GameLogic memory game = registry.getGameLogic(id);
        assertEq(game.bettingEnabled, false);
        assertEq(game.maxStreets, 0);
    }

    function test_RegisterLogic_EmptyCID() public {
        vm.expectRevert("Empty CID");
        registry.registerLogic("", developer, true, 4);
    }

    function test_RegisterLogic_InvalidDeveloper() public {
        vm.expectRevert("Invalid developer");
        registry.registerLogic(IPFS_CID, address(0), true, 4);
    }

    function test_RegisterLogic_Duplicate() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        
        vm.expectRevert("Logic already registered");
        registry.registerLogic(IPFS_CID, developer, true, 4);
    }

    function test_RegisterLogic_NotOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        registry.registerLogic(IPFS_CID, developer, true, 4);
    }

    // ==================== VERIFICATION TESTS ====================

    function test_SetVerificationStatus() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        
        registry.setVerificationStatus(logicId, true);
        assertTrue(registry.isVerified(logicId));
        
        registry.setVerificationStatus(logicId, false);
        assertFalse(registry.isVerified(logicId));
    }

    function test_SetVerificationStatus_NotFound() public {
        vm.expectRevert("Logic not found");
        registry.setVerificationStatus(logicId, true);
    }

    function test_SetVerificationStatus_NotOwner() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        
        vm.prank(address(0x999));
        vm.expectRevert();
        registry.setVerificationStatus(logicId, true);
    }

    // ==================== BETTING CONFIGURATION TESTS ====================

    function test_SetBettingEnabled() public {
        registry.registerLogic(IPFS_CID, developer, false, 0);
        
        assertFalse(registry.isBettingEnabled(logicId));
        
        registry.setBettingEnabled(logicId, true);
        assertTrue(registry.isBettingEnabled(logicId));
        
        registry.setBettingEnabled(logicId, false);
        assertFalse(registry.isBettingEnabled(logicId));
    }

    function test_SetBettingEnabled_NotFound() public {
        vm.expectRevert("Logic not found");
        registry.setBettingEnabled(logicId, true);
    }

    function test_SetBettingEnabled_NotOwner() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        
        vm.prank(address(0x999));
        vm.expectRevert();
        registry.setBettingEnabled(logicId, false);
    }

    function test_SetMaxStreets() public {
        registry.registerLogic(IPFS_CID, developer, true, 1);
        
        assertEq(registry.getMaxStreets(logicId), 1);
        
        registry.setMaxStreets(logicId, 4);
        assertEq(registry.getMaxStreets(logicId), 4);
        
        registry.setMaxStreets(logicId, 5);
        assertEq(registry.getMaxStreets(logicId), 5);
    }

    function test_SetMaxStreets_NotFound() public {
        vm.expectRevert("Logic not found");
        registry.setMaxStreets(logicId, 4);
    }

    // ==================== ESCROW AUTHORIZATION TESTS (C2 FIX) ====================

    function test_SetAuthorizedEscrow() public {
        registry.setAuthorizedEscrow(escrow, true);
        assertTrue(registry.isAuthorizedEscrow(escrow));
        
        registry.setAuthorizedEscrow(escrow, false);
        assertFalse(registry.isAuthorizedEscrow(escrow));
    }

    function test_SetAuthorizedEscrow_InvalidAddress() public {
        vm.expectRevert("Invalid escrow");
        registry.setAuthorizedEscrow(address(0), true);
    }

    function test_SetAuthorizedEscrow_NotOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        registry.setAuthorizedEscrow(escrow, true);
    }

    // ==================== VOLUME TRACKING TESTS (C2 FIX) ====================

    function test_RecordVolume() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.setAuthorizedEscrow(escrow, true);
        
        vm.prank(escrow);
        registry.recordVolume(logicId, 1000 * 1e6);
        
        assertEq(registry.getVolume(logicId), 1000 * 1e6);
        
        vm.prank(escrow);
        registry.recordVolume(logicId, 500 * 1e6);
        
        assertEq(registry.getVolume(logicId), 1500 * 1e6);
    }

    function test_RecordVolume_NotAuthorized() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        // Don't authorize escrow
        
        vm.prank(escrow);
        vm.expectRevert("Not authorized escrow");
        registry.recordVolume(logicId, 1000 * 1e6);
    }

    function test_RecordVolume_NotFound() public {
        registry.setAuthorizedEscrow(escrow, true);
        
        vm.prank(escrow);
        vm.expectRevert("Logic not found");
        registry.recordVolume(logicId, 1000 * 1e6);
    }

    // ==================== VIEW FUNCTION TESTS ====================

    function test_GetAllLogicIds() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.registerLogic(IPFS_CID_2, developer, false, 0);
        
        bytes32[] memory ids = registry.getAllLogicIds();
        assertEq(ids.length, 2);
        assertEq(ids[0], logicId);
        assertEq(ids[1], logicId2);
    }

    function test_GetGameLogic_NotFound() public {
        vm.expectRevert("Logic not found");
        registry.getGameLogic(logicId);
    }

    function test_RegistryViewFunctions() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        
        assertEq(registry.getIpfsCid(logicId), IPFS_CID);
        assertEq(registry.getDeveloper(logicId), developer);
        assertEq(registry.isVerified(logicId), false);
        assertEq(registry.isBettingEnabled(logicId), true);
        assertEq(registry.getMaxStreets(logicId), 4);
        assertEq(registry.getVolume(logicId), 0);
    }

    // ==================== BATCH OPERATIONS TESTS ====================

    function test_GetGameLogicsBatch() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.registerLogic(IPFS_CID_2, developer, false, 0);
        
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = logicId;
        ids[1] = logicId2;
        
        LogicRegistry.GameLogic[] memory games = registry.getGameLogicsBatch(ids);
        
        assertEq(games.length, 2);
        assertEq(games[0].bettingEnabled, true);
        assertEq(games[1].bettingEnabled, false);
    }

    // ==================== POKER VARIANT REGISTRATION TESTS ====================

    function test_RegisterFiveCardDraw() public {
        // 5-Card Draw: bettingEnabled=true, maxStreets=1
        bytes32 id = registry.registerLogic(
            "QmFiveCardDraw",
            developer,
            true,  // betting
            1      // 1 street
        );
        
        assertTrue(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 1);
    }

    function test_RegisterTexasHoldem() public {
        // Texas Hold'em: bettingEnabled=true, maxStreets=4
        bytes32 id = registry.registerLogic(
            "QmTexasHoldem",
            developer,
            true,  // betting
            4      // 4 streets
        );
        
        assertTrue(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 4);
    }

    function test_RegisterSevenCardStud() public {
        // 7-Card Stud: bettingEnabled=true, maxStreets=5
        bytes32 id = registry.registerLogic(
            "QmSevenCardStud",
            developer,
            true,  // betting
            5      // 5 streets
        );
        
        assertTrue(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 5);
    }

    function test_RegisterRPS() public {
        // Rock Paper Scissors: bettingEnabled=false, maxStreets=0
        bytes32 id = registry.registerSimpleGame("QmRPS", developer);
        
        assertFalse(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 0);
    }

    // ==================== EDGE CASE TESTS ====================

    function test_MultipleGamesSameDeveloper() public {
        registry.registerLogic("QmGame1", developer, true, 4);
        registry.registerLogic("QmGame2", developer, false, 0);
        registry.registerLogic("QmGame3", developer, true, 1);
        
        assertEq(registry.getRegistryCount(), 3);
    }

    function test_VolumeAccumulation() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.setAuthorizedEscrow(escrow, true);
        registry.setAuthorizedEscrow(address(0x789), true);
        
        // Multiple escrows recording volume
        vm.prank(escrow);
        registry.recordVolume(logicId, 100 * 1e6);
        
        vm.prank(address(0x789));
        registry.recordVolume(logicId, 200 * 1e6);
        
        vm.prank(escrow);
        registry.recordVolume(logicId, 300 * 1e6);
        
        assertEq(registry.getVolume(logicId), 600 * 1e6);
    }

    function test_UpdateBettingAfterRegistration() public {
        // Register as non-betting game
        registry.registerSimpleGame(IPFS_CID, developer);
        
        assertFalse(registry.isBettingEnabled(logicId));
        assertEq(registry.getMaxStreets(logicId), 0);
        
        // Update to betting game
        registry.setBettingEnabled(logicId, true);
        registry.setMaxStreets(logicId, 4);
        
        assertTrue(registry.isBettingEnabled(logicId));
        assertEq(registry.getMaxStreets(logicId), 4);
    }
}
