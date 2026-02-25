// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/MatchEscrow.sol";
import "../src/core/PriceProvider.sol";
import "../src/games/RPS.sol";

contract DeployFalken is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address priceFeed = vm.envAddress("PRICE_FEED_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy RPS Logic
        RPS rps = new RPS();
        console.log("RPS Logic deployed at:", address(rps));

        // 2. Deploy PriceProvider ($2 min stake)
        PriceProvider priceProvider = new PriceProvider(priceFeed, 2 * 1e18);
        console.log("PriceProvider deployed at:", address(priceProvider));

        // 3. Deploy MatchEscrow
        MatchEscrow escrow = new MatchEscrow(treasury, address(priceProvider));
        console.log("MatchEscrow deployed at:", address(escrow));

        // 4. Whitelist RPS Logic
        escrow.approveGameLogic(address(rps), true);
        console.log("RPS Logic whitelisted.");

        vm.stopBroadcast();

        console.log("-----------------------------------------");
        console.log("FALKEN DEPLOYMENT COMPLETE");
        console.log("Copy these to your .env file:");
        console.log("ESCROW_ADDRESS=", address(escrow));
        console.log("RPS_LOGIC_ADDRESS=", address(rps));
        console.log("PRICE_PROVIDER_ADDRESS=", address(priceProvider));
        console.log("-----------------------------------------");
    }
}
