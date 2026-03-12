// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/core/PredictionPool.sol";

/**
 * @title DeployPredictionPool
 * @dev Deployment script for the PredictionPool contract
 *
 * Environment variables required:
 * - PRIVATE_KEY: Deployer private key
 * - TREASURY_ADDRESS: Address to receive rake
 * - USDC_ADDRESS: USDC token contract address
 *
 * Optional:
 * - AUTHORIZED_ESCROWS: Comma-separated list of escrow addresses to authorize
 */
contract DeployPredictionPool is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);

        // Deploy PredictionPool
        PredictionPool predictionPool = new PredictionPool(treasury, usdcAddress);

        console.log("PredictionPool:", address(predictionPool));
        console.log("Treasury:", treasury);
        console.log("USDC:", usdcAddress);
        console.log("Deployer:", vm.addr(deployerPrivateKey));

        // Authorize escrows if provided
        string memory authorizedEscrows = vm.envOr("AUTHORIZED_ESCROWS", string(""));
        if (bytes(authorizedEscrows).length > 0) {
            string[] memory escrowAddresses = _split(authorizedEscrows, ",");
            for (uint i = 0; i < escrowAddresses.length; i++) {
                address escrow = _parseAddress(escrowAddresses[i]);
                predictionPool.setAuthorizedEscrow(escrow, true);
                console.log("Authorized escrow:", escrow);
            }
        }

        vm.stopBroadcast();
    }

    // Helper function to split a string by delimiter
    function _split(string memory _base, string memory _delimiter) internal pure returns (string[] memory) {
        bytes memory baseBytes = bytes(_base);
        bytes memory delimiterBytes = bytes(_delimiter);
        
        // Count occurrences
        uint count = 1;
        for (uint i = 0; i < baseBytes.length; i++) {
            if (_isDelimiter(baseBytes, i, delimiterBytes)) {
                count++;
                i += delimiterBytes.length - 1;
            }
        }

        // Create result array
        string[] memory result = new string[](count);
        uint resultIndex = 0;
        uint start = 0;

        for (uint i = 0; i < baseBytes.length; i++) {
            if (_isDelimiter(baseBytes, i, delimiterBytes)) {
                result[resultIndex] = _substring(_base, start, i);
                resultIndex++;
                start = i + delimiterBytes.length;
                i += delimiterBytes.length - 1;
            }
        }
        result[resultIndex] = _substring(_base, start, baseBytes.length);

        return result;
    }

    function _isDelimiter(bytes memory base, uint index, bytes memory delimiter) internal pure returns (bool) {
        if (index + delimiter.length > base.length) return false;
        for (uint i = 0; i < delimiter.length; i++) {
            if (base[index + i] != delimiter[i]) return false;
        }
        return true;
    }

    function _substring(string memory _base, uint _start, uint _end) internal pure returns (string memory) {
        bytes memory baseBytes = bytes(_base);
        bytes memory result = new bytes(_end - _start);
        for (uint i = _start; i < _end; i++) {
            result[i - _start] = baseBytes[i];
        }
        return string(result);
    }

    function _parseAddress(string memory _a) internal pure returns (address) {
        bytes memory tmp = bytes(_a);
        uint160 addr = 0;
        uint160 b = 0;
        for (uint i = 0; i < tmp.length; i++) {
            b = uint160(uint8(tmp[i]));
            if (b >= 48 && b <= 57) {
                addr = addr * 16 + (b - 48);
            } else if (b >= 65 && b <= 70) {
                addr = addr * 16 + (b - 55);
            } else if (b >= 97 && b <= 102) {
                addr = addr * 16 + (b - 87);
            }
        }
        return address(addr);
    }
}
