// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/core/LogicRegistry.sol";

contract LogicRegistryTest is Test {
    LogicRegistry public registry;

    address public owner = address(0x1);
    address public developer1 = address(0x111);
    address public developer2 = address(0x222);
    address public randomUser = address(0x999);

    function setUp() public {
        vm.prank(owner);
        registry = new LogicRegistry();
    }

    // ==================== CONSTRUCTOR ====================

    function test_Constructor_SetsOwner() public {
        // Verify owner is set correctly (Ownable behavior)
        assertEq(registry.owner(), owner);
    }

    // ==================== REGISTER LOGIC ====================

    function test_RegisterLogic_Success() public {
        string memory ipfsCid = "bafkreiabc123...poker";
        
        vm.prank(owner);
        bytes32 logicId = registry.registerLogic(ipfsCid, developer1);
        
        // Verify logicId is correct hash
        bytes32 expectedId = keccak256(abi.encodePacked(ipfsCid));
        assertEq(logicId, expectedId);
        
        // Verify struct data via registry mapping
        (string memory cid, address dev, bool verified, uint256 createdAt, uint256 volume) = registry.registry(logicId);
        
        assertEq(cid, ipfsCid);
        assertEq(dev, developer1);
        assertEq(verified, false);
        assertEq(volume, 0);
        assertGt(createdAt, 0); // Should be set to block.timestamp
    }

    function test_RegisterLogic_MultipleLogics() public {
        string memory cid1 = "bafkrei...poker";
        string memory cid2 = "bafkrei...chess";
        string memory cid3 = "bafkrei...rps";
        
        vm.startPrank(owner);
        bytes32 id1 = registry.registerLogic(cid1, developer1);
        bytes32 id2 = registry.registerLogic(cid2, developer2);
        bytes32 id3 = registry.registerLogic(cid3, developer1);
        vm.stopPrank();
        
        // Verify all unique
        assertTrue(id1 != id2);
        assertTrue(id2 != id3);
        assertTrue(id1 != id3);
        
        // Verify count
        assertEq(registry.getRegistryCount(), 3);
        
        // Verify allLogicIds array
        assertEq(registry.allLogicIds(0), id1);
        assertEq(registry.allLogicIds(1), id2);
        assertEq(registry.allLogicIds(2), id3);
    }

    function test_RegisterLogic_EmitsEvent() public {
        string memory ipfsCid = "bafkrei...test";
        bytes32 expectedId = keccak256(abi.encodePacked(ipfsCid));
        
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit LogicRegistry.LogicRegistered(expectedId, ipfsCid, developer1);
        
        registry.registerLogic(ipfsCid, developer1);
    }

    function test_RevertRegisterLogic_AlreadyRegistered() public {
        string memory ipfsCid = "bafkrei...duplicate";
        
        vm.prank(owner);
        registry.registerLogic(ipfsCid, developer1);
        
        // Try to register same CID again
        vm.prank(owner);
        vm.expectRevert("Logic already registered");
        registry.registerLogic(ipfsCid, developer2);
    }

    function test_RevertRegisterLogic_NotOwner() public {
        string memory ipfsCid = "bafkrei...unauthorized";
        
        vm.prank(randomUser);
        vm.expectRevert();
        registry.registerLogic(ipfsCid, developer1);
    }

    // ==================== SET VERIFICATION STATUS ====================

    function test_SetVerificationStatus_Success() public {
        string memory ipfsCid = "bafkrei...verify";
        
        vm.prank(owner);
        bytes32 logicId = registry.registerLogic(ipfsCid, developer1);
        
        // Initially not verified
        (,, bool verifiedBefore,,) = registry.registry(logicId);
        assertEq(verifiedBefore, false);
        
        // Verify it
        vm.prank(owner);
        registry.setVerificationStatus(logicId, true);
        
        // Check verified
        (,, bool verifiedAfter,,) = registry.registry(logicId);
        assertEq(verifiedAfter, true);
        
        // Can also un-verify
        vm.prank(owner);
        registry.setVerificationStatus(logicId, false);
        
        (,, bool verifiedFinal,,) = registry.registry(logicId);
        assertEq(verifiedFinal, false);
    }

    function test_SetVerificationStatus_EmitsEvent() public {
        string memory ipfsCid = "bafkrei...event";
        
        vm.prank(owner);
        bytes32 logicId = registry.registerLogic(ipfsCid, developer1);
        
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit LogicRegistry.LogicVerified(logicId, true);
        
        registry.setVerificationStatus(logicId, true);
    }

    function test_RevertSetVerificationStatus_LogicNotFound() public {
        bytes32 fakeLogicId = keccak256("nonexistent");
        
        vm.prank(owner);
        vm.expectRevert("Logic not found");
        registry.setVerificationStatus(fakeLogicId, true);
    }

    function test_RevertSetVerificationStatus_NotOwner() public {
        string memory ipfsCid = "bafkrei...notowner";
        
        vm.prank(owner);
        bytes32 logicId = registry.registerLogic(ipfsCid, developer1);
        
        vm.prank(randomUser);
        vm.expectRevert();
        registry.setVerificationStatus(logicId, true);
    }

    // ==================== RECORD VOLUME ====================

    function test_RecordVolume_Success() public {
        string memory ipfsCid = "bafkrei...volume";
        
        vm.prank(owner);
        bytes32 logicId = registry.registerLogic(ipfsCid, developer1);
        
        // Initially zero volume
        (,,,, uint256 volumeBefore) = registry.registry(logicId);
        assertEq(volumeBefore, 0);
        
        // Record some volume
        vm.prank(randomUser); // Anyone can call (currently unrestricted)
        registry.recordVolume(logicId, 1000);
        
        (,,,, uint256 volumeAfter) = registry.registry(logicId);
        assertEq(volumeAfter, 1000);
    }

    function test_RecordVolume_MultipleRecords() public {
        string memory ipfsCid = "bafkrei...multi";
        
        vm.prank(owner);
        bytes32 logicId = registry.registerLogic(ipfsCid, developer1);
        
        // Record volume multiple times
        registry.recordVolume(logicId, 100);
        registry.recordVolume(logicId, 200);
        registry.recordVolume(logicId, 300);
        
        (,,,, uint256 volume) = registry.registry(logicId);
        assertEq(volume, 600);
    }

    function test_RecordVolume_DifferentLogics() public {
        string memory cid1 = "bafkrei...vol1";
        string memory cid2 = "bafkrei...vol2";
        
        vm.startPrank(owner);
        bytes32 id1 = registry.registerLogic(cid1, developer1);
        bytes32 id2 = registry.registerLogic(cid2, developer2);
        vm.stopPrank();
        
        // Record different volumes
        registry.recordVolume(id1, 1000);
        registry.recordVolume(id2, 2000);
        registry.recordVolume(id1, 500); // Add more to id1
        
        (,,,, uint256 vol1) = registry.registry(id1);
        (,,,, uint256 vol2) = registry.registry(id2);
        
        assertEq(vol1, 1500);
        assertEq(vol2, 2000);
    }

    // ==================== GET REGISTRY COUNT ====================

    function test_GetRegistryCount_Zero() public {
        assertEq(registry.getRegistryCount(), 0);
    }

    function test_GetRegistryCount_AfterRegister() public {
        vm.startPrank(owner);
        registry.registerLogic("cid1", developer1);
        assertEq(registry.getRegistryCount(), 1);
        
        registry.registerLogic("cid2", developer2);
        assertEq(registry.getRegistryCount(), 2);
        
        registry.registerLogic("cid3", developer1);
        assertEq(registry.getRegistryCount(), 3);
        vm.stopPrank();
    }

    // ==================== ALL LOGIC IDS ARRAY ====================

    function test_AllLogicIds_ArrayAccess() public {
        string memory cid1 = "bafkrei...arr1";
        string memory cid2 = "bafkrei...arr2";
        
        vm.startPrank(owner);
        bytes32 id1 = registry.registerLogic(cid1, developer1);
        bytes32 id2 = registry.registerLogic(cid2, developer2);
        vm.stopPrank();
        
        // Access array directly
        assertEq(registry.allLogicIds(0), id1);
        assertEq(registry.allLogicIds(1), id2);
    }

    function test_AllLogicIds_ArrayLength() public {
        vm.startPrank(owner);
        registry.registerLogic("cid1", developer1);
        registry.registerLogic("cid2", developer2);
        registry.registerLogic("cid3", developer1);
        vm.stopPrank();
        
        // Array should have 3 elements (index 0, 1, 2)
        // We verify this by checking count matches
        assertEq(registry.getRegistryCount(), 3);
    }

    // ==================== REGISTRY MAPPING GETTER ====================

    function test_RegistryMapping_ReturnsCorrectData() public {
        string memory ipfsCid = "bafkrei...complete";
        
        vm.prank(owner);
        bytes32 logicId = registry.registerLogic(ipfsCid, developer1);
        
        // Record volume and verify
        registry.recordVolume(logicId, 5000);
        
        // Verify status
        vm.prank(owner);
        registry.setVerificationStatus(logicId, true);
        
        // Get full struct
        (string memory cid, address dev, bool verified, uint256 createdAt, uint256 volume) = registry.registry(logicId);
        
        assertEq(cid, ipfsCid);
        assertEq(dev, developer1);
        assertEq(verified, true);
        assertEq(volume, 5000);
        assertGt(createdAt, 0);
    }

    function test_RegistryMapping_EmptyLogicId() public {
        bytes32 nonExistentId = keccak256("doesnotexist");
        
        // Should return empty struct
        (string memory cid, address dev, bool verified, uint256 createdAt, uint256 volume) = registry.registry(nonExistentId);
        
        assertEq(bytes(cid).length, 0);
        assertEq(dev, address(0));
        assertEq(verified, false);
        assertEq(createdAt, 0);
        assertEq(volume, 0);
    }
}
