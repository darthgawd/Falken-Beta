// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev Mock USDC that can blocklist addresses, causing transfers to revert.
 * Used to test the pull-payment fallback in BaseEscrow._safeTransferUSDC.
 */
contract BlocklistMockUSDC is ERC20 {
    mapping(address => bool) public blocklisted;

    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 10**6);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function blocklist(address account) external {
        blocklisted[account] = true;
    }

    function unblocklist(address account) external {
        blocklisted[account] = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocklisted[from], "Blocklisted sender");
        require(!blocklisted[to], "Blocklisted recipient");
        super._update(from, to, value);
    }
}
