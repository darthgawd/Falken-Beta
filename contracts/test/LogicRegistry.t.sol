// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/LogicRegistry.sol";

contract LogicRegistryTest is Test {
    LogicRegistry registry;

    address owner     = address(this); // test contract deploys, so it's owner
    address developer = address(0x1111);
    address escrow    = address(0x2222);
    address stranger  = address(0x3333);

    string constant CID  = "QmPokerBlitz123";
    string constant CID2 = "QmRPS456";
    bytes32 LOGIC_ID;
    bytes32 LOGIC_ID2;

    function setUp() public {
        registry = new LogicRegistry();
        LOGIC_ID  = keccak256(abi.encodePacked(CID));
        LOGIC_ID2 = keccak256(abi.encodePacked(CID2));
    }

    // ==================== CONSTRUCTOR ====================

    function test_Constructor_OwnerIsDeployer() public view {
        assertEq(registry.owner(), owner);
    }

    function test_Constructor_EmptyRegistry() public view {
        assertEq(registry.getRegistryCount(), 0);
        assertEq(registry.getAllLogicIds().length, 0);
    }

    // ==================== REGISTER LOGIC ====================

    function test_RegisterLogic_HappyPath() public {
        bytes32 id = registry.registerLogic(CID, developer, true, 4);

        assertEq(id, LOGIC_ID);

        LogicRegistry.GameLogic memory g = registry.getGameLogic(id);
        assertEq(g.ipfsCid,        CID);
        assertEq(g.developer,      developer);
        assertEq(g.bettingEnabled, true);
        assertEq(g.maxStreets,     4);
        assertEq(g.isActive,       true);
        assertEq(g.isVerified,     false);
        assertEq(g.totalVolume,    0);
        assertEq(g.createdAt,      block.timestamp);
    }

    function test_RegisterLogic_ReturnsCorrectId() public {
        bytes32 id = registry.registerLogic(CID, developer, false, 1);
        assertEq(id, keccak256(abi.encodePacked(CID)));
    }

    function test_RegisterLogic_AppendsToAllLogicIds() public {
        registry.registerLogic(CID,  developer, true, 4);
        registry.registerLogic(CID2, developer, false, 1);

        bytes32[] memory ids = registry.getAllLogicIds();
        assertEq(ids.length, 2);
        assertEq(ids[0], LOGIC_ID);
        assertEq(ids[1], LOGIC_ID2);
    }

    function test_RegisterLogic_EmptyCid_Reverts() public {
        vm.expectRevert("Empty CID");
        registry.registerLogic("", developer, false, 1);
    }

    function test_RegisterLogic_ZeroDeveloper_Reverts() public {
        vm.expectRevert("Invalid developer");
        registry.registerLogic(CID, address(0), false, 1);
    }

    function test_RegisterLogic_Duplicate_Reverts() public {
        registry.registerLogic(CID, developer, false, 1);
        vm.expectRevert("Logic already registered");
        registry.registerLogic(CID, developer, false, 1);
    }

    function test_RegisterLogic_NotOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.registerLogic(CID, developer, false, 1);
    }

    function test_RegisterLogic_WhenPaused_Reverts() public {
        registry.pause();
        vm.expectRevert();
        registry.registerLogic(CID, developer, false, 1);
    }

    function test_RegisterLogic_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit LogicRegistry.LogicRegistered(LOGIC_ID, CID, developer, true, 4);
        registry.registerLogic(CID, developer, true, 4);
    }

    // ==================== REGISTER SIMPLE GAME ====================

    function test_RegisterSimpleGame_HappyPath() public {
        bytes32 id = registry.registerSimpleGame(CID, developer);

        LogicRegistry.GameLogic memory g = registry.getGameLogic(id);
        assertEq(g.ipfsCid,        CID);
        assertEq(g.developer,      developer);
        assertEq(g.bettingEnabled, false);
        assertEq(g.maxStreets,     0);
        assertEq(g.isActive,       true);
        assertEq(g.isVerified,     false);
    }

    function test_RegisterSimpleGame_EmptyCid_Reverts() public {
        vm.expectRevert("Empty CID");
        registry.registerSimpleGame("", developer);
    }

    function test_RegisterSimpleGame_ZeroDeveloper_Reverts() public {
        vm.expectRevert("Invalid developer");
        registry.registerSimpleGame(CID, address(0));
    }

    function test_RegisterSimpleGame_Duplicate_Reverts() public {
        registry.registerSimpleGame(CID, developer);
        vm.expectRevert("Logic already registered");
        registry.registerSimpleGame(CID, developer);
    }

    function test_RegisterSimpleGame_NotOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.registerSimpleGame(CID, developer);
    }

    function test_RegisterSimpleGame_WhenPaused_Reverts() public {
        registry.pause();
        vm.expectRevert();
        registry.registerSimpleGame(CID, developer);
    }

    function test_RegisterSimpleGame_SameCidAsRegisterLogic_Reverts() public {
        // Both hash the CID the same way — same CID causes a conflict
        registry.registerLogic(CID, developer, true, 4);
        vm.expectRevert("Logic already registered");
        registry.registerSimpleGame(CID, developer);
    }

    function test_RegisterSimpleGame_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit LogicRegistry.LogicRegistered(LOGIC_ID, CID, developer, false, 0);
        registry.registerSimpleGame(CID, developer);
    }

    // ==================== VERIFICATION ====================

    function test_SetVerificationStatus_True() public {
        registry.registerLogic(CID, developer, false, 1);
        registry.setVerificationStatus(LOGIC_ID, true);
        assertTrue(registry.isVerified(LOGIC_ID));
    }

    function test_SetVerificationStatus_False() public {
        registry.registerLogic(CID, developer, false, 1);
        registry.setVerificationStatus(LOGIC_ID, true);
        registry.setVerificationStatus(LOGIC_ID, false);
        assertFalse(registry.isVerified(LOGIC_ID));
    }

    function test_SetVerificationStatus_LogicNotFound_Reverts() public {
        vm.expectRevert("Logic not found");
        registry.setVerificationStatus(LOGIC_ID, true);
    }

    function test_SetVerificationStatus_NotOwner_Reverts() public {
        registry.registerLogic(CID, developer, false, 1);
        vm.prank(stranger);
        vm.expectRevert();
        registry.setVerificationStatus(LOGIC_ID, true);
    }

    function test_SetVerificationStatus_EmitsEvent() public {
        registry.registerLogic(CID, developer, false, 1);
        vm.expectEmit(true, false, false, true);
        emit LogicRegistry.LogicVerified(LOGIC_ID, true);
        registry.setVerificationStatus(LOGIC_ID, true);
    }

    // ==================== ACTIVE / DEACTIVATION ====================

    function test_SetActive_Deactivate() public {
        registry.registerLogic(CID, developer, false, 1);
        assertTrue(registry.isActive(LOGIC_ID)); // starts active

        registry.setActive(LOGIC_ID, false);
        assertFalse(registry.isActive(LOGIC_ID));
    }

    function test_SetActive_Reactivate() public {
        registry.registerLogic(CID, developer, false, 1);
        registry.setActive(LOGIC_ID, false);
        registry.setActive(LOGIC_ID, true);
        assertTrue(registry.isActive(LOGIC_ID));
    }

    function test_SetActive_LogicNotFound_Reverts() public {
        vm.expectRevert("Logic not found");
        registry.setActive(LOGIC_ID, false);
    }

    function test_SetActive_NotOwner_Reverts() public {
        registry.registerLogic(CID, developer, false, 1);
        vm.prank(stranger);
        vm.expectRevert();
        registry.setActive(LOGIC_ID, false);
    }

    function test_SetActive_EmitsEvent() public {
        registry.registerLogic(CID, developer, false, 1);
        vm.expectEmit(true, false, false, true);
        emit LogicRegistry.LogicActiveSet(LOGIC_ID, false);
        registry.setActive(LOGIC_ID, false);
    }

    // ==================== BETTING CONFIGURATION ====================

    function test_SetBettingEnabled_Enable() public {
        registry.registerSimpleGame(CID, developer); // starts false
        assertFalse(registry.isBettingEnabled(LOGIC_ID));

        registry.setBettingEnabled(LOGIC_ID, true);
        assertTrue(registry.isBettingEnabled(LOGIC_ID));
    }

    function test_SetBettingEnabled_Disable() public {
        registry.registerLogic(CID, developer, true, 4);
        registry.setBettingEnabled(LOGIC_ID, false);
        assertFalse(registry.isBettingEnabled(LOGIC_ID));
    }

    function test_SetBettingEnabled_LogicNotFound_Reverts() public {
        vm.expectRevert("Logic not found");
        registry.setBettingEnabled(LOGIC_ID, true);
    }

    function test_SetBettingEnabled_NotOwner_Reverts() public {
        registry.registerLogic(CID, developer, false, 1);
        vm.prank(stranger);
        vm.expectRevert();
        registry.setBettingEnabled(LOGIC_ID, true);
    }

    function test_SetBettingEnabled_EmitsEvent() public {
        registry.registerLogic(CID, developer, false, 1);
        vm.expectEmit(true, false, false, true);
        emit LogicRegistry.BettingEnabledSet(LOGIC_ID, true);
        registry.setBettingEnabled(LOGIC_ID, true);
    }

    // ==================== MAX STREETS ====================

    function test_SetMaxStreets() public {
        registry.registerLogic(CID, developer, true, 1);
        assertEq(registry.getMaxStreets(LOGIC_ID), 1);

        registry.setMaxStreets(LOGIC_ID, 4);
        assertEq(registry.getMaxStreets(LOGIC_ID), 4);
    }

    function test_SetMaxStreets_LogicNotFound_Reverts() public {
        vm.expectRevert("Logic not found");
        registry.setMaxStreets(LOGIC_ID, 4);
    }

    function test_SetMaxStreets_NotOwner_Reverts() public {
        registry.registerLogic(CID, developer, true, 1);
        vm.prank(stranger);
        vm.expectRevert();
        registry.setMaxStreets(LOGIC_ID, 4);
    }

    function test_SetMaxStreets_EmitsEvent() public {
        registry.registerLogic(CID, developer, true, 1);
        vm.expectEmit(true, false, false, true);
        emit LogicRegistry.MaxStreetsSet(LOGIC_ID, 5);
        registry.setMaxStreets(LOGIC_ID, 5);
    }

    // ==================== PAUSE / UNPAUSE ====================

    function test_Pause_BlocksRegistration() public {
        registry.pause();
        vm.expectRevert();
        registry.registerLogic(CID, developer, false, 1);
    }

    function test_Unpause_RestoresRegistration() public {
        registry.pause();
        registry.unpause();
        registry.registerLogic(CID, developer, false, 1);
        assertEq(registry.getRegistryCount(), 1);
    }

    function test_Pause_NotOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.pause();
    }

    function test_Unpause_NotOwner_Reverts() public {
        registry.pause();
        vm.prank(stranger);
        vm.expectRevert();
        registry.unpause();
    }

    function test_Pause_AdminSettersStillWork() public {
        // setVerificationStatus, setActive, etc. are NOT gated by whenNotPaused
        registry.registerLogic(CID, developer, false, 1);
        registry.pause();

        registry.setVerificationStatus(LOGIC_ID, true);
        registry.setActive(LOGIC_ID, false);

        assertTrue(registry.isVerified(LOGIC_ID));
        assertFalse(registry.isActive(LOGIC_ID));
    }

    // ==================== ESCROW AUTHORIZATION ====================

    function test_SetAuthorizedEscrow_Authorize() public {
        registry.setAuthorizedEscrow(escrow, true);
        assertTrue(registry.authorizedEscrows(escrow));
        assertTrue(registry.isAuthorizedEscrow(escrow));
    }

    function test_SetAuthorizedEscrow_Deauthorize() public {
        registry.setAuthorizedEscrow(escrow, true);
        registry.setAuthorizedEscrow(escrow, false);
        assertFalse(registry.isAuthorizedEscrow(escrow));
    }

    function test_SetAuthorizedEscrow_ZeroAddress_Reverts() public {
        vm.expectRevert("Invalid escrow");
        registry.setAuthorizedEscrow(address(0), true);
    }

    function test_SetAuthorizedEscrow_NotOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.setAuthorizedEscrow(escrow, true);
    }

    function test_SetAuthorizedEscrow_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LogicRegistry.EscrowAuthorized(escrow, true);
        registry.setAuthorizedEscrow(escrow, true);
    }

    // ==================== RECORD VOLUME ====================

    function test_RecordVolume_HappyPath() public {
        registry.registerLogic(CID, developer, false, 1);
        registry.setAuthorizedEscrow(escrow, true);

        vm.prank(escrow);
        registry.recordVolume(LOGIC_ID, 500 * 1e6);

        assertEq(registry.getVolume(LOGIC_ID), 500 * 1e6);
    }

    function test_RecordVolume_Accumulates() public {
        registry.registerLogic(CID, developer, false, 1);
        registry.setAuthorizedEscrow(escrow, true);

        vm.prank(escrow); registry.recordVolume(LOGIC_ID, 100 * 1e6);
        vm.prank(escrow); registry.recordVolume(LOGIC_ID, 250 * 1e6);

        assertEq(registry.getVolume(LOGIC_ID), 350 * 1e6);
    }

    function test_RecordVolume_NotAuthorized_Reverts() public {
        registry.registerLogic(CID, developer, false, 1);

        vm.prank(stranger);
        vm.expectRevert("Not authorized escrow");
        registry.recordVolume(LOGIC_ID, 100 * 1e6);
    }

    function test_RecordVolume_LogicNotFound_Reverts() public {
        registry.setAuthorizedEscrow(escrow, true);

        vm.prank(escrow);
        vm.expectRevert("Logic not found");
        registry.recordVolume(LOGIC_ID, 100 * 1e6);
    }

    function test_RecordVolume_AfterDeauthorize_Reverts() public {
        registry.registerLogic(CID, developer, false, 1);
        registry.setAuthorizedEscrow(escrow, true);
        registry.setAuthorizedEscrow(escrow, false);

        vm.prank(escrow);
        vm.expectRevert("Not authorized escrow");
        registry.recordVolume(LOGIC_ID, 100 * 1e6);
    }

    function test_RecordVolume_MultipleEscrows() public {
        address escrow2 = address(0x4444);
        registry.registerLogic(CID, developer, false, 1);
        registry.setAuthorizedEscrow(escrow,  true);
        registry.setAuthorizedEscrow(escrow2, true);

        vm.prank(escrow);  registry.recordVolume(LOGIC_ID, 100 * 1e6);
        vm.prank(escrow2); registry.recordVolume(LOGIC_ID, 200 * 1e6);

        assertEq(registry.getVolume(LOGIC_ID), 300 * 1e6);
    }

    function test_RecordVolume_EmitsEvent() public {
        registry.registerLogic(CID, developer, false, 1);
        registry.setAuthorizedEscrow(escrow, true);

        vm.expectEmit(true, false, false, true);
        emit LogicRegistry.VolumeRecorded(LOGIC_ID, 100 * 1e6);
        vm.prank(escrow);
        registry.recordVolume(LOGIC_ID, 100 * 1e6);
    }

    // ==================== VIEW FUNCTIONS ====================

    function test_GetDeveloper() public {
        registry.registerLogic(CID, developer, false, 1);
        assertEq(registry.getDeveloper(LOGIC_ID), developer);
    }

    function test_GetIpfsCid() public {
        registry.registerLogic(CID, developer, false, 1);
        assertEq(registry.getIpfsCid(LOGIC_ID), CID);
    }

    function test_GetMaxStreets_SimpleGame_IsZero() public {
        registry.registerSimpleGame(CID, developer);
        assertEq(registry.getMaxStreets(LOGIC_ID), 0);
    }

    function test_IsBettingEnabled_Default_False() public {
        registry.registerSimpleGame(CID, developer);
        assertFalse(registry.isBettingEnabled(LOGIC_ID));
    }

    function test_IsActive_DefaultTrue() public {
        registry.registerLogic(CID, developer, false, 1);
        assertTrue(registry.isActive(LOGIC_ID));
    }

    function test_IsVerified_DefaultFalse() public {
        registry.registerLogic(CID, developer, false, 1);
        assertFalse(registry.isVerified(LOGIC_ID));
    }

    function test_GetVolume_DefaultZero() public {
        registry.registerLogic(CID, developer, false, 1);
        assertEq(registry.getVolume(LOGIC_ID), 0);
    }

    function test_UnregisteredLogic_ViewsReturnDefaults() public view {
        // No revert — just zero/false defaults from mappings
        assertEq(registry.getDeveloper(LOGIC_ID),      address(0));
        assertEq(registry.getIpfsCid(LOGIC_ID),        "");
        assertEq(registry.getMaxStreets(LOGIC_ID),     0);
        assertFalse(registry.isBettingEnabled(LOGIC_ID));
        assertFalse(registry.isActive(LOGIC_ID));
        assertFalse(registry.isVerified(LOGIC_ID));
        assertEq(registry.getVolume(LOGIC_ID),         0);
    }

    // ==================== REGISTRY COUNT & DISCOVERY ====================

    function test_GetRegistryCount_Empty() public view {
        assertEq(registry.getRegistryCount(), 0);
    }

    function test_GetRegistryCount_AfterRegistrations() public {
        registry.registerLogic(CID,  developer, true,  4);
        registry.registerLogic(CID2, developer, false, 1);
        assertEq(registry.getRegistryCount(), 2);
    }

    function test_GetAllLogicIds_Empty() public view {
        assertEq(registry.getAllLogicIds().length, 0);
    }

    function test_GetAllLogicIds_Order() public {
        registry.registerLogic(CID,  developer, true, 4);
        registry.registerLogic(CID2, developer, false, 1);

        bytes32[] memory ids = registry.getAllLogicIds();
        assertEq(ids[0], LOGIC_ID);
        assertEq(ids[1], LOGIC_ID2);
    }

    // ==================== GET GAME LOGIC ====================

    function test_GetGameLogic_HappyPath() public {
        registry.registerLogic(CID, developer, true, 4);
        LogicRegistry.GameLogic memory g = registry.getGameLogic(LOGIC_ID);
        assertEq(g.ipfsCid,        CID);
        assertEq(g.developer,      developer);
        assertEq(g.bettingEnabled, true);
        assertEq(g.maxStreets,     4);
        assertEq(g.isActive,       true);
        assertEq(g.isVerified,     false);
        assertEq(g.totalVolume,    0);
    }

    function test_GetGameLogic_NotFound_Reverts() public {
        vm.expectRevert("Logic not found");
        registry.getGameLogic(LOGIC_ID);
    }

    // ==================== BATCH OPERATIONS ====================

    function test_GetGameLogicsBatch_HappyPath() public {
        registry.registerLogic(CID,  developer, true,  4);
        registry.registerLogic(CID2, developer, false, 1);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = LOGIC_ID;
        ids[1] = LOGIC_ID2;

        LogicRegistry.GameLogic[] memory results = registry.getGameLogicsBatch(ids);
        assertEq(results.length,       2);
        assertEq(results[0].ipfsCid,   CID);
        assertEq(results[0].maxStreets, 4);
        assertEq(results[1].ipfsCid,   CID2);
        assertEq(results[1].maxStreets, 1);
    }

    function test_GetGameLogicsBatch_InvalidId_Reverts() public {
        registry.registerLogic(CID, developer, true, 4);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = LOGIC_ID;
        ids[1] = LOGIC_ID2; // not registered

        vm.expectRevert("Logic not found");
        registry.getGameLogicsBatch(ids);
    }

    function test_GetGameLogicsBatch_EmptyArray() public view {
        bytes32[] memory ids    = new bytes32[](0);
        LogicRegistry.GameLogic[] memory results = registry.getGameLogicsBatch(ids);
        assertEq(results.length, 0);
    }

    // ==================== OWNERSHIP (Ownable2Step) ====================

    function test_TransferOwnership_TwoStep() public {
        address newOwner = address(0xBEEF);
        registry.transferOwnership(newOwner);

        // Pending — original owner still in control
        assertEq(registry.owner(),        owner);
        assertEq(registry.pendingOwner(), newOwner);

        vm.prank(newOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), newOwner);
    }

    function test_TransferOwnership_OnlyPendingCanAccept() public {
        address newOwner = address(0xBEEF);
        registry.transferOwnership(newOwner);

        vm.prank(stranger);
        vm.expectRevert();
        registry.acceptOwnership();
    }

    function test_NewOwner_CanRegisterLogic() public {
        address newOwner = address(0xBEEF);
        registry.transferOwnership(newOwner);
        vm.prank(newOwner); registry.acceptOwnership();

        vm.prank(newOwner);
        registry.registerLogic(CID, developer, false, 1);
        assertEq(registry.getRegistryCount(), 1);
    }

    function test_OldOwner_CannotRegisterAfterTransfer() public {
        address newOwner = address(0xBEEF);
        registry.transferOwnership(newOwner);
        vm.prank(newOwner); registry.acceptOwnership();

        vm.prank(owner);
        vm.expectRevert();
        registry.registerLogic(CID, developer, false, 1);
    }
}
