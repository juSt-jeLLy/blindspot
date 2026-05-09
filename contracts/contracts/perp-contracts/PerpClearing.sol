// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PerpClearing is ZamaEthereumConfig {
    address public owner;
    address public orderBook;

    struct Position {
        euint64 longSize;
        euint64 shortSize;
    }

    mapping(address => Position) private _positions;

    event PositionIncreased(address indexed trader, bool isLong);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyOrderBook() {
        require(msg.sender == orderBook, "only orderbook");
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "zero owner");
        owner = owner_;
    }

    function setOrderBook(address orderBook_) external onlyOwner {
        require(orderBook_ != address(0), "zero orderbook");
        orderBook = orderBook_;
    }

    function applyTrade(address longTrader, address shortTrader, euint64 fillSize) external onlyOrderBook {
        Position storage longPos = _positions[longTrader];
        Position storage shortPos = _positions[shortTrader];

        longPos.longSize = FHE.add(longPos.longSize, fillSize);
        shortPos.shortSize = FHE.add(shortPos.shortSize, fillSize);

        // Re-allow fresh handles after each mutation.
        FHE.allowThis(longPos.longSize);
        FHE.allow(longPos.longSize, longTrader);
        FHE.allowThis(shortPos.shortSize);
        FHE.allow(shortPos.shortSize, shortTrader);

        emit PositionIncreased(longTrader, true);
        emit PositionIncreased(shortTrader, false);
    }

    function getPositionHandles(address trader) external view returns (bytes32 longHandle, bytes32 shortHandle) {
        Position storage p = _positions[trader];
        return (euint64.unwrap(p.longSize), euint64.unwrap(p.shortSize));
    }
}
