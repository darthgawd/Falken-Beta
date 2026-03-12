// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/core/LogicRegistry.sol";
import "../src/core/FiseEscrow.sol";

contract DeployFalken is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Logic Registry
        LogicRegistry logicRegistry = new LogicRegistry();

        // 2. Deploy FISE Escrow
        // For Alpha, we set the deployer as the initial Referee
        FiseEscrow escrow = new FiseEscrow(
            treasury,
            usdcAddress,
            address(logicRegistry),
            vm.addr(deployerPrivateKey) 
        );

        console.log("LogicRegistry:", address(logicRegistry));
        console.log("FiseEscrow:", address(escrow));
        console.log("Referee:", vm.addr(deployerPrivateKey));

        vm.stopBroadcast();
    }
}
