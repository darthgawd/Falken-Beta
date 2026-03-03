// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPriceProvider {
    event PriceUpdated(uint256 newMinStakeUsd);

    /**
     * @notice Returns the amount of ETH required for a given USD amount.
     * @param _usdAmount The amount in USD (18 decimals).
     */
    function getEthAmount(uint256 _usdAmount) external view returns (uint256);

    /**
     * @notice Returns the USD value of a given ETH amount (18 decimals).
     * @param _ethAmount The amount in ETH (18 decimals).
     */
    function getUsdValue(uint256 _ethAmount) external view returns (uint256);

    /**
     * @notice Returns the minimum stake required in USD (18 decimals).
     */
    function getMinStakeUsd() external view returns (uint256);
}
