// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title LogicRegistry
 * @dev On-chain registry for Falken Immutable Scripting Engine (FISE) game logic.
 * V4 Updates:
 *   - Ownable2Step for safe ownership transfer
 *   - Pausable for emergency circuit breaker
 *   - bettingEnabled flag per game
 *   - maxStreets for poker variants
 *   - isActive flag for game deactivation
 *   - Authorized escrow whitelist for recordVolume
 */
contract LogicRegistry is Ownable2Step, Pausable {

    struct GameLogic {
        string ipfsCid;          // The IPFS hash of the JavaScript logic
        address developer;       // The wallet that deployed/owns the logic
        bool isVerified;         // Whether the protocol has audited/verified this logic
        bool isActive;           // Whether this game is active (can be used in new matches)
        bool bettingEnabled;     // Whether this game supports betting phases
        uint8 maxStreets;        // For poker variants (1=5-card draw, 4=hold'em)
        uint256 createdAt;       // Registration timestamp
        uint256 totalVolume;     // Aggregated USDC volume played via this logic
    }

    // Mapping from a logic ID (keccak256 of CID) to GameLogic metadata
    mapping(bytes32 => GameLogic) public registry;

    // Quick lookup for all registered logic IDs
    bytes32[] public allLogicIds;

    // Authorized escrow contracts that can record volume
    mapping(address => bool) public authorizedEscrows;

    // Events
    event LogicRegistered(
        bytes32 indexed logicId,
        string ipfsCid,
        address indexed developer,
        bool bettingEnabled,
        uint8 maxStreets
    );
    event LogicVerified(bytes32 indexed logicId, bool status);
    event LogicActiveSet(bytes32 indexed logicId, bool active);
    event BettingEnabledSet(bytes32 indexed logicId, bool enabled);
    event MaxStreetsSet(bytes32 indexed logicId, uint8 maxStreets);
    event EscrowAuthorized(address indexed escrow, bool status);
    event VolumeRecorded(bytes32 indexed logicId, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // --- REGISTRATION ---

    /**
     * @dev Registers a new game logic via its IPFS CID.
     * Restricted to Protocol Owner for curated Beta phase.
     */
    function registerLogic(
        string calldata ipfsCid,
        address developer,
        bool bettingEnabled,
        uint8 maxStreets
    ) external onlyOwner whenNotPaused returns (bytes32) {
        require(bytes(ipfsCid).length > 0, "Empty CID");
        require(developer != address(0), "Invalid developer");

        bytes32 logicId = keccak256(abi.encodePacked(ipfsCid));

        require(bytes(registry[logicId].ipfsCid).length == 0, "Logic already registered");

        registry[logicId] = GameLogic({
            ipfsCid: ipfsCid,
            developer: developer,
            isVerified: false,
            isActive: true,
            bettingEnabled: bettingEnabled,
            maxStreets: maxStreets,
            createdAt: block.timestamp,
            totalVolume: 0
        });

        allLogicIds.push(logicId);

        emit LogicRegistered(logicId, ipfsCid, developer, bettingEnabled, maxStreets);
        return logicId;
    }

    /**
     * @dev Convenience function for simple games without betting.
     * Defaults: bettingEnabled=false, maxStreets=0
     */
    function registerSimpleGame(
        string calldata ipfsCid,
        address developer
    ) external onlyOwner whenNotPaused returns (bytes32) {
        require(bytes(ipfsCid).length > 0, "Empty CID");
        require(developer != address(0), "Invalid developer");

        bytes32 logicId = keccak256(abi.encodePacked(ipfsCid));
        require(bytes(registry[logicId].ipfsCid).length == 0, "Logic already registered");

        registry[logicId] = GameLogic({
            ipfsCid: ipfsCid,
            developer: developer,
            isVerified: false,
            isActive: true,
            bettingEnabled: false,
            maxStreets: 0,
            createdAt: block.timestamp,
            totalVolume: 0
        });

        allLogicIds.push(logicId);

        emit LogicRegistered(logicId, ipfsCid, developer, false, 0);
        return logicId;
    }

    // --- VERIFICATION ---

    function setVerificationStatus(bytes32 logicId, bool status) external onlyOwner {
        require(_logicExists(logicId), "Logic not found");
        registry[logicId].isVerified = status;
        emit LogicVerified(logicId, status);
    }

    // --- ACTIVATION / DEACTIVATION ---

    /**
     * @dev Activate or deactivate a game. Deactivated games cannot be used
     * for new matches but existing matches continue normally.
     */
    function setActive(bytes32 logicId, bool active) external onlyOwner {
        require(_logicExists(logicId), "Logic not found");
        registry[logicId].isActive = active;
        emit LogicActiveSet(logicId, active);
    }

    // --- BETTING CONFIGURATION ---

    function setBettingEnabled(bytes32 logicId, bool enabled) external onlyOwner {
        require(_logicExists(logicId), "Logic not found");
        registry[logicId].bettingEnabled = enabled;
        emit BettingEnabledSet(logicId, enabled);
    }

    /**
     * @dev Set max streets for poker variants.
     * 1 = 5-Card Draw, 4 = Texas Hold'em / Omaha, 5 = 7-Card Stud
     */
    function setMaxStreets(bytes32 logicId, uint8 maxStreets) external onlyOwner {
        require(_logicExists(logicId), "Logic not found");
        registry[logicId].maxStreets = maxStreets;
        emit MaxStreetsSet(logicId, maxStreets);
    }

    // --- PAUSABLE ---

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- VIEW FUNCTIONS ---

    function isBettingEnabled(bytes32 logicId) external view returns (bool) {
        return registry[logicId].bettingEnabled;
    }

    function getMaxStreets(bytes32 logicId) external view returns (uint8) {
        return registry[logicId].maxStreets;
    }

    function isVerified(bytes32 logicId) external view returns (bool) {
        return registry[logicId].isVerified;
    }

    function isActive(bytes32 logicId) external view returns (bool) {
        return registry[logicId].isActive;
    }

    function getDeveloper(bytes32 logicId) external view returns (address) {
        return registry[logicId].developer;
    }

    function getIpfsCid(bytes32 logicId) external view returns (string memory) {
        return registry[logicId].ipfsCid;
    }

    function getVolume(bytes32 logicId) external view returns (uint256) {
        return registry[logicId].totalVolume;
    }

    // --- ESCROW AUTHORIZATION ---

    function setAuthorizedEscrow(address escrow, bool status) external onlyOwner {
        require(escrow != address(0), "Invalid escrow");
        authorizedEscrows[escrow] = status;
        emit EscrowAuthorized(escrow, status);
    }

    function isAuthorizedEscrow(address escrow) external view returns (bool) {
        return authorizedEscrows[escrow];
    }

    // --- VOLUME TRACKING ---

    function recordVolume(bytes32 logicId, uint256 amount) external {
        require(authorizedEscrows[msg.sender], "Not authorized escrow");
        require(_logicExists(logicId), "Logic not found");

        registry[logicId].totalVolume += amount;
        emit VolumeRecorded(logicId, amount);
    }

    // --- BATCH OPERATIONS ---

    /**
     * @dev Get all logic IDs (for discovery).
     * WARNING: Can be expensive for many games.
     */
    function getAllLogicIds() external view returns (bytes32[] memory) {
        return allLogicIds;
    }

    function getRegistryCount() external view returns (uint256) {
        return allLogicIds.length;
    }

    function getGameLogic(bytes32 logicId) external view returns (GameLogic memory) {
        require(_logicExists(logicId), "Logic not found");
        return registry[logicId];
    }

    /**
     * @dev Get multiple game logics in one call. Reverts if any ID is invalid.
     */
    function getGameLogicsBatch(bytes32[] calldata logicIds)
        external
        view
        returns (GameLogic[] memory)
    {
        GameLogic[] memory results = new GameLogic[](logicIds.length);
        for (uint i = 0; i < logicIds.length; i++) {
            require(_logicExists(logicIds[i]), "Logic not found");
            results[i] = registry[logicIds[i]];
        }
        return results;
    }

    // --- INTERNAL HELPERS ---

    function _logicExists(bytes32 logicId) internal view returns (bool) {
        return bytes(registry[logicId].ipfsCid).length > 0;
    }
}
