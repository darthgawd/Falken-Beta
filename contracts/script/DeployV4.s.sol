// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/core/LogicRegistry.sol";
import "../src/core/PokerEngine.sol";
import "../src/core/PredictionPool.sol";

/**
 * @title DeployV4
 * @dev Master deployment script for Falken Protocol V4.
 * Deploys LogicRegistry, PokerEngine, and PredictionPool.
 */
contract DeployV4 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address referee = vm.envAddress("REFEREE_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Logic Registry
        LogicRegistry logicRegistry = new LogicRegistry();
        console.log("LogicRegistry V4 deployed at:", address(logicRegistry));

        // 2. Deploy Poker Engine (The Betting Powerhouse)
        PokerEngine pokerEngine = new PokerEngine(
            treasury,
            usdcAddress,
            address(logicRegistry),
            referee
        );
        console.log("PokerEngine V4 deployed at:", address(pokerEngine));

        // 3. Deploy Prediction Pool (The Spectator Hub)
        PredictionPool predictionPool = new PredictionPool(treasury, usdcAddress);
        console.log("PredictionPool V4 deployed at:", address(predictionPool));

        // 4. Cross-Contract Authorization
        logicRegistry.setAuthorizedEscrow(address(pokerEngine), true);
        predictionPool.setAuthorizedEscrow(address(pokerEngine), true);
        
        console.log("--- AUTHORIZATIONS COMPLETE ---");
        console.log("PokerEngine authorized in Registry and Pool.");

        vm.stopBroadcast();
    }
}
