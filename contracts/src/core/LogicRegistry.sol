// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LogicRegistry
 * @dev On-chain registry for Falken Immutable Scripting Engine (FISE) game logic.
 * Developers register their IPFS CID (Immutable Script Hash) here.
 */
contract LogicRegistry is Ownable {
    
    struct GameLogic {
        string ipfsCID;      // The IPFS hash of the JavaScript logic
        address developer;   // The wallet that deployed/owns the logic
        bool isVerified;     // Whether the protocol has audited/verified this logic
        uint256 createdAt;   // Registration timestamp
        uint256 totalVolume; // Aggregated ETH volume played via this logic
    }

    // Mapping from a logic ID (keccak256 of CID) to GameLogic metadata
    mapping(bytes32 => GameLogic) public registry;
    
    // Quick lookup for all registered logic IDs
    bytes32[] public allLogicIds;

    event LogicRegistered(bytes32 indexed logicId, string ipfsCID, address indexed developer);
    event LogicVerified(bytes32 indexed logicId, bool status);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Registers a new game logic via its IPFS CID.
     */
    function registerLogic(string calldata _ipfsCID) external returns (bytes32) {
        bytes32 logicId = keccak256(abi.encodePacked(_ipfsCID));
        
        require(bytes(registry[logicId].ipfsCID).length == 0, "Logic already registered");

        registry[logicId] = GameLogic({
            ipfsCID: _ipfsCID,
            developer: msg.sender,
            isVerified: false,
            createdAt: block.timestamp,
            totalVolume: 0
        });

        allLogicIds.push(logicId);

        emit LogicRegistered(logicId, _ipfsCID, msg.sender);
        return logicId;
    }

    /**
     * @dev Allows protocol owner to verify logic for high-stakes play.
     */
    function setVerificationStatus(bytes32 _logicId, bool _status) external onlyOwner {
        require(bytes(registry[_logicId].ipfsCID).length > 0, "Logic not found");
        registry[_logicId].isVerified = _status;
        emit LogicVerified(_logicId, _status);
    }

    /**
     * @dev Records volume for a specific logic (called by MatchEscrow).
     */
    function recordVolume(bytes32 _logicId, uint256 _amount) external {
        // In a real implementation, we would restrict this to the MatchEscrow address
        registry[_logicId].totalVolume += _amount;
    }

    /**
     * @dev Returns the total number of registered games.
     */
    function getRegistryCount() external view returns (uint256) {
        return allLogicIds.length;
    }
}
