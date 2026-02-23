// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/MatchEscrow.sol";
import "../src/logic/SimpleDice.sol";

contract DeploySimpleDice is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address escrowAddress = vm.envAddress("ESCROW_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy SimpleDice Logic
        SimpleDice dice = new SimpleDice();
        console.log("SimpleDice Logic deployed at:", address(dice));

        // 2. Get MatchEscrow instance
        MatchEscrow escrow = MatchEscrow(escrowAddress);

        // 3. Whitelist SimpleDice Logic
        escrow.approveGameLogic(address(dice), true);
        console.log("SimpleDice Logic whitelisted in Escrow.");

        vm.stopBroadcast();

        console.log("-----------------------------------------");
        console.log("NEW GAME DEPLOYMENT COMPLETE");
        console.log("Add this to your .env file if you want to play it:");
        console.log("DICE_LOGIC_ADDRESS=", address(dice));
        console.log("-----------------------------------------");
    }
}
