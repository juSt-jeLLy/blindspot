// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

contract PerpOracle {
    address public owner;
    uint256 private _price1e8;
    uint256 public updatedAt;

    event PriceUpdated(uint256 price1e8, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address owner_, uint256 initialPrice1e8) {
        require(owner_ != address(0), "zero owner");
        require(initialPrice1e8 > 0, "bad price");
        owner = owner_;
        _price1e8 = initialPrice1e8;
        updatedAt = block.timestamp;
    }

    function setPrice1e8(uint256 price1e8) external onlyOwner {
        require(price1e8 > 0, "bad price");
        _price1e8 = price1e8;
        updatedAt = block.timestamp;
        emit PriceUpdated(price1e8, block.timestamp);
    }

    function getPrice1e8() external view returns (uint256) {
        return _price1e8;
    }
}
