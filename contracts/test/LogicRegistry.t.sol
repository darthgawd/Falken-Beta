// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/LogicRegistry.sol";

contract LogicRegistryTest is Test {
    LogicRegistry registry;
    address owner = address(this);
    address developer = address(0x123);
    address newOwner = address(0xABC);
    address escrow = address(0x456);
    address nobody = address(0x999);

    string constant IPFS_CID = "QmTest123";
    string constant IPFS_CID_2 = "QmTest456";
    bytes32 logicId;
    bytes32 logicId2;

    event LogicRegistered(bytes32 indexed logicId, string ipfsCid, address indexed developer, bool bettingEnabled, uint8 maxStreets);
    event LogicVerified(bytes32 indexed logicId, bool status);
    event LogicActiveSet(bytes32 indexed logicId, bool active);
    event BettingEnabledSet(bytes32 indexed logicId, bool enabled);
    event MaxStreetsSet(bytes32 indexed logicId, uint8 maxStreets);
    event EscrowAuthorized(address indexed escrow, bool status);
    event VolumeRecorded(bytes32 indexed logicId, uint256 amount);

    function setUp() public {
        registry = new LogicRegistry();
        logicId = keccak256(abi.encodePacked(IPFS_CID));
        logicId2 = keccak256(abi.encodePacked(IPFS_CID_2));
    }

    // ==================== CONSTRUCTOR ====================

    function test_Constructor() public view {
        assertEq(registry.getRegistryCount(), 0);
        assertEq(registry.owner(), owner);
    }

    // ==================== OWNABLE2STEP ====================

    function test_TransferOwnership_TwoStep() public {
        registry.transferOwnership(newOwner);
        // Owner hasn't changed yet — pending
        assertEq(registry.owner(), owner);
        assertEq(registry.pendingOwner(), newOwner);

        // New owner accepts
        vm.prank(newOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), newOwner);
    }

    function test_TransferOwnership_OnlyPendingCanAccept() public {
        registry.transferOwnership(newOwner);

        vm.prank(nobody);
        vm.expectRevert();
        registry.acceptOwnership();
    }

    function test_TransferOwnership_NotOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        registry.transferOwnership(newOwner);
    }

    // ==================== REGISTRATION ====================

    function test_RegisterLogic() public {
        vm.expectEmit(true, true, false, true);
        emit LogicRegistered(logicId, IPFS_CID, developer, true, 4);

        bytes32 id = registry.registerLogic(IPFS_CID, developer, true, 4);

        assertEq(id, logicId);
        assertEq(registry.getRegistryCount(), 1);

        LogicRegistry.GameLogic memory game = registry.getGameLogic(id);
        assertEq(game.ipfsCid, IPFS_CID);
        assertEq(game.developer, developer);
        assertFalse(game.isVerified);
        assertTrue(game.isActive);
        assertTrue(game.bettingEnabled);
        assertEq(game.maxStreets, 4);
        assertEq(game.totalVolume, 0);
        assertTrue(game.createdAt > 0);
    }

    function test_RegisterSimpleGame() public {
        bytes32 id = registry.registerSimpleGame(IPFS_CID, developer);

        LogicRegistry.GameLogic memory game = registry.getGameLogic(id);
        assertFalse(game.bettingEnabled);
        assertEq(game.maxStreets, 0);
        assertTrue(game.isActive);
    }

    function test_RegisterLogic_EmptyCID() public {
        vm.expectRevert("Empty CID");
        registry.registerLogic("", developer, true, 4);
    }

    function test_RegisterSimpleGame_EmptyCID() public {
        vm.expectRevert("Empty CID");
        registry.registerSimpleGame("", developer);
    }

    function test_RegisterLogic_InvalidDeveloper() public {
        vm.expectRevert("Invalid developer");
        registry.registerLogic(IPFS_CID, address(0), true, 4);
    }

    function test_RegisterSimpleGame_InvalidDeveloper() public {
        vm.expectRevert("Invalid developer");
        registry.registerSimpleGame(IPFS_CID, address(0));
    }

    function test_RegisterLogic_Duplicate() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);

        vm.expectRevert("Logic already registered");
        registry.registerLogic(IPFS_CID, developer, true, 4);
    }

    function test_RegisterSimpleGame_Duplicate() public {
        registry.registerSimpleGame(IPFS_CID, developer);

        vm.expectRevert("Logic already registered");
        registry.registerSimpleGame(IPFS_CID, developer);
    }

    function test_RegisterLogic_NotOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        registry.registerLogic(IPFS_CID, developer, true, 4);
    }

    function test_RegisterSimpleGame_NotOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        registry.registerSimpleGame(IPFS_CID, developer);
    }

    function test_RegisterLogic_WhenPaused() public {
        registry.pause();

        vm.expectRevert();
        registry.registerLogic(IPFS_CID, developer, true, 4);
    }

    function test_RegisterSimpleGame_WhenPaused() public {
        registry.pause();

        vm.expectRevert();
        registry.registerSimpleGame(IPFS_CID, developer);
    }

    // ==================== VERIFICATION ====================

    function test_SetVerificationStatus() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);

        vm.expectEmit(true, false, false, true);
        emit LogicVerified(logicId, true);
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

        vm.prank(nobody);
        vm.expectRevert();
        registry.setVerificationStatus(logicId, true);
    }

    // ==================== ACTIVATION / DEACTIVATION ====================

    function test_SetActive_Deactivate() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        assertTrue(registry.isActive(logicId));

        vm.expectEmit(true, false, false, true);
        emit LogicActiveSet(logicId, false);
        registry.setActive(logicId, false);
        assertFalse(registry.isActive(logicId));
    }

    function test_SetActive_Reactivate() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.setActive(logicId, false);
        assertFalse(registry.isActive(logicId));

        registry.setActive(logicId, true);
        assertTrue(registry.isActive(logicId));
    }

    function test_SetActive_NotFound() public {
        vm.expectRevert("Logic not found");
        registry.setActive(logicId, false);
    }

    function test_SetActive_NotOwner() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);

        vm.prank(nobody);
        vm.expectRevert();
        registry.setActive(logicId, false);
    }

    // ==================== BETTING CONFIGURATION ====================

    function test_SetBettingEnabled() public {
        registry.registerLogic(IPFS_CID, developer, false, 0);
        assertFalse(registry.isBettingEnabled(logicId));

        vm.expectEmit(true, false, false, true);
        emit BettingEnabledSet(logicId, true);
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

        vm.prank(nobody);
        vm.expectRevert();
        registry.setBettingEnabled(logicId, false);
    }

    function test_SetMaxStreets() public {
        registry.registerLogic(IPFS_CID, developer, true, 1);
        assertEq(registry.getMaxStreets(logicId), 1);

        vm.expectEmit(true, false, false, true);
        emit MaxStreetsSet(logicId, 4);
        registry.setMaxStreets(logicId, 4);
        assertEq(registry.getMaxStreets(logicId), 4);

        registry.setMaxStreets(logicId, 5);
        assertEq(registry.getMaxStreets(logicId), 5);
    }

    function test_SetMaxStreets_NotFound() public {
        vm.expectRevert("Logic not found");
        registry.setMaxStreets(logicId, 4);
    }

    function test_SetMaxStreets_NotOwner() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);

        vm.prank(nobody);
        vm.expectRevert();
        registry.setMaxStreets(logicId, 1);
    }

    // ==================== PAUSABLE ====================

    function test_Pause() public {
        registry.pause();
        assertTrue(registry.paused());
    }

    function test_Unpause() public {
        registry.pause();
        registry.unpause();
        assertFalse(registry.paused());
    }

    function test_Pause_NotOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        registry.pause();
    }

    function test_Unpause_NotOwner() public {
        registry.pause();

        vm.prank(nobody);
        vm.expectRevert();
        registry.unpause();
    }

    function test_AdminFunctions_WorkWhenPaused() public {
        // Registration requires not-paused, but admin config functions still work
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.pause();

        // These should all still work while paused
        registry.setVerificationStatus(logicId, true);
        registry.setActive(logicId, false);
        registry.setBettingEnabled(logicId, false);
        registry.setMaxStreets(logicId, 1);
        registry.setAuthorizedEscrow(escrow, true);

        assertTrue(registry.isVerified(logicId));
        assertFalse(registry.isActive(logicId));
        assertFalse(registry.isBettingEnabled(logicId));
        assertEq(registry.getMaxStreets(logicId), 1);
        assertTrue(registry.isAuthorizedEscrow(escrow));
    }

    // ==================== ESCROW AUTHORIZATION ====================

    function test_SetAuthorizedEscrow() public {
        vm.expectEmit(true, false, false, true);
        emit EscrowAuthorized(escrow, true);
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
        vm.prank(nobody);
        vm.expectRevert();
        registry.setAuthorizedEscrow(escrow, true);
    }

    // ==================== VOLUME TRACKING ====================

    function test_RecordVolume() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.setAuthorizedEscrow(escrow, true);

        vm.expectEmit(true, false, false, true);
        emit VolumeRecorded(logicId, 1000 * 1e6);

        vm.prank(escrow);
        registry.recordVolume(logicId, 1000 * 1e6);
        assertEq(registry.getVolume(logicId), 1000 * 1e6);

        vm.prank(escrow);
        registry.recordVolume(logicId, 500 * 1e6);
        assertEq(registry.getVolume(logicId), 1500 * 1e6);
    }

    function test_RecordVolume_NotAuthorized() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);

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

    function test_RecordVolume_DeauthorizedEscrow() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.setAuthorizedEscrow(escrow, true);

        // Record once OK
        vm.prank(escrow);
        registry.recordVolume(logicId, 100 * 1e6);

        // Deauthorize
        registry.setAuthorizedEscrow(escrow, false);

        // Now fails
        vm.prank(escrow);
        vm.expectRevert("Not authorized escrow");
        registry.recordVolume(logicId, 100 * 1e6);
    }

    // ==================== VIEW FUNCTIONS ====================

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
        assertFalse(registry.isVerified(logicId));
        assertTrue(registry.isActive(logicId));
        assertTrue(registry.isBettingEnabled(logicId));
        assertEq(registry.getMaxStreets(logicId), 4);
        assertEq(registry.getVolume(logicId), 0);
    }

    function test_ViewFunctions_NonExistentLogic() public view {
        // View functions on non-existent IDs return defaults (no revert)
        assertFalse(registry.isBettingEnabled(logicId));
        assertEq(registry.getMaxStreets(logicId), 0);
        assertFalse(registry.isVerified(logicId));
        assertFalse(registry.isActive(logicId));
        assertEq(registry.getDeveloper(logicId), address(0));
        assertEq(registry.getVolume(logicId), 0);
    }

    // ==================== BATCH OPERATIONS ====================

    function test_GetGameLogicsBatch() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.registerLogic(IPFS_CID_2, developer, false, 0);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = logicId;
        ids[1] = logicId2;

        LogicRegistry.GameLogic[] memory games = registry.getGameLogicsBatch(ids);

        assertEq(games.length, 2);
        assertTrue(games[0].bettingEnabled);
        assertFalse(games[1].bettingEnabled);
        assertTrue(games[0].isActive);
        assertTrue(games[1].isActive);
    }

    function test_GetGameLogicsBatch_InvalidId() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = logicId;
        ids[1] = logicId2; // not registered

        vm.expectRevert("Logic not found");
        registry.getGameLogicsBatch(ids);
    }

    function test_GetGameLogicsBatch_Empty() public view {
        bytes32[] memory ids = new bytes32[](0);
        LogicRegistry.GameLogic[] memory games = registry.getGameLogicsBatch(ids);
        assertEq(games.length, 0);
    }

    // ==================== POKER VARIANT REGISTRATION ====================

    function test_RegisterFiveCardDraw() public {
        bytes32 id = registry.registerLogic("QmFiveCardDraw", developer, true, 1);
        assertTrue(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 1);
    }

    function test_RegisterTexasHoldem() public {
        bytes32 id = registry.registerLogic("QmTexasHoldem", developer, true, 4);
        assertTrue(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 4);
    }

    function test_RegisterSevenCardStud() public {
        bytes32 id = registry.registerLogic("QmSevenCardStud", developer, true, 5);
        assertTrue(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 5);
    }

    function test_RegisterRPS() public {
        bytes32 id = registry.registerSimpleGame("QmRPS", developer);
        assertFalse(registry.isBettingEnabled(id));
        assertEq(registry.getMaxStreets(id), 0);
    }

    // ==================== EDGE CASES ====================

    function test_MultipleGamesSameDeveloper() public {
        registry.registerLogic("QmGame1", developer, true, 4);
        registry.registerLogic("QmGame2", developer, false, 0);
        registry.registerLogic("QmGame3", developer, true, 1);

        assertEq(registry.getRegistryCount(), 3);
    }

    function test_VolumeAccumulation_MultipleEscrows() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.setAuthorizedEscrow(escrow, true);
        registry.setAuthorizedEscrow(address(0x789), true);

        vm.prank(escrow);
        registry.recordVolume(logicId, 100 * 1e6);

        vm.prank(address(0x789));
        registry.recordVolume(logicId, 200 * 1e6);

        vm.prank(escrow);
        registry.recordVolume(logicId, 300 * 1e6);

        assertEq(registry.getVolume(logicId), 600 * 1e6);
    }

    function test_UpdateBettingAfterRegistration() public {
        registry.registerSimpleGame(IPFS_CID, developer);

        assertFalse(registry.isBettingEnabled(logicId));
        assertEq(registry.getMaxStreets(logicId), 0);

        registry.setBettingEnabled(logicId, true);
        registry.setMaxStreets(logicId, 4);

        assertTrue(registry.isBettingEnabled(logicId));
        assertEq(registry.getMaxStreets(logicId), 4);
    }

    function test_DeactivatedGame_StillReadable() public {
        registry.registerLogic(IPFS_CID, developer, true, 4);
        registry.setActive(logicId, false);

        // All data still readable even when deactivated
        LogicRegistry.GameLogic memory game = registry.getGameLogic(logicId);
        assertEq(game.ipfsCid, IPFS_CID);
        assertEq(game.developer, developer);
        assertFalse(game.isActive);
        assertTrue(game.bettingEnabled);
    }
}
