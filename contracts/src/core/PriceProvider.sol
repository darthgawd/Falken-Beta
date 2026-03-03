// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "../interfaces/IPriceProvider.sol";

contract PriceProvider is IPriceProvider, Ownable {
    AggregatorV3Interface public immutable priceFeed;
    uint256 public minStakeUsd;
    uint256 public manualPrice; // 8 decimals (e.g. 3000 * 1e8)

    constructor(address _priceFeed, uint256 _minStakeUsd) Ownable(msg.sender) {
        require(_priceFeed != address(0), "Invalid price feed");
        priceFeed = AggregatorV3Interface(_priceFeed);
        minStakeUsd = _minStakeUsd;
    }

    function setMinStakeUsd(uint256 _minStakeUsd) external onlyOwner {
        minStakeUsd = _minStakeUsd;
        emit PriceUpdated(_minStakeUsd);
    }

    function setManualPrice(uint256 _price) external onlyOwner {
        manualPrice = _price;
    }

    function getEthAmount(uint256 _usdAmount) public view override returns (uint256) {
        uint256 price;
        if (manualPrice > 0) {
            price = manualPrice;
        } else {
            (, int256 p,, uint256 updatedAt,) = priceFeed.latestRoundData();
            require(p > 0, "Invalid price");
            require(block.timestamp <= updatedAt + 24 hours, "Price stale");
            price = uint256(p);
        }
        
        // Chainlink ETH/USD feed has 8 decimals.
        // We want ETH (18 decimals).
        // Formula: (usdAmount * 1e8) / price
        return (_usdAmount * 1e8) / price;
    }

    function getUsdValue(uint256 _ethAmount) public view override returns (uint256) {
        uint256 price;
        if (manualPrice > 0) {
            price = manualPrice;
        } else {
            (, int256 p,, uint256 updatedAt,) = priceFeed.latestRoundData();
            require(p > 0, "Invalid price");
            require(block.timestamp <= updatedAt + 24 hours, "Price stale");
            price = uint256(p);
        }
        
        // price has 8 decimals. ethAmount has 18.
        // Result should be USD with 18 decimals.
        return (_ethAmount * price) / 1e8;
    }

    function getMinStakeUsd() external view override returns (uint256) {
        return minStakeUsd;
    }
}
