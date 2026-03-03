// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/core/PriceProvider.sol";
import "../src/core/LogicRegistry.sol";
import "../src/core/FiseEscrow.sol";
import "../src/games/RPS.sol";

contract DeployFalken is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Price Provider ($2 USD min stake)
        // Note: Using standard Base Sepolia Chainlink Feed
        PriceProvider priceProvider = new PriceProvider(0x4adC67696ba3F238D520607D003f756024f60C77, 2 ether);
        
        // 2. Deploy Logic Registry
        LogicRegistry logicRegistry = new LogicRegistry();

        // 3. Deploy FISE Escrow (The new main vault)
        // For Beta, we'll set the deployer as the initial Referee
        FiseEscrow escrow = new FiseEscrow(
            treasury,
            address(priceProvider),
            address(logicRegistry),
            vm.addr(deployerPrivateKey) 
        );

        // 4. Deploy and Approve RPS Logic (The POC)
        RPS rps = new RPS();
        escrow.approveGameLogic(address(rps), true);

        console.log("PriceProvider:", address(priceProvider));
        console.log("LogicRegistry:", address(logicRegistry));
        console.log("FiseEscrow:", address(escrow));
        console.log("RPS_Logic:", address(rps));

        vm.stopBroadcast();
    }
}
