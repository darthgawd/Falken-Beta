// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/MatchEscrow.sol";
import "../src/games/RPS.sol";

contract DeployBotByte is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy RPS Logic
        RPS rps = new RPS();
        console.log("RPS Logic deployed at:", address(rps));

        // 2. Deploy MatchEscrow
        MatchEscrow escrow = new MatchEscrow(treasury);
        console.log("MatchEscrow deployed at:", address(escrow));

        // 3. Whitelist RPS Logic
        escrow.approveGameLogic(address(rps), true);
        console.log("RPS Logic whitelisted.");

        vm.stopBroadcast();

        console.log("-----------------------------------------");
        console.log("BOTBYTE DEPLOYMENT COMPLETE");
        console.log("Copy these to your .env file:");
        console.log("ESCROW_ADDRESS=", address(escrow));
        console.log("RPS_LOGIC_ADDRESS=", address(rps));
        console.log("-----------------------------------------");
    }
}
