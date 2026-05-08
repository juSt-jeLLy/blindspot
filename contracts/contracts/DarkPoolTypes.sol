// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";

enum Side {
    Sell,
    Buy
}

enum OrderStatus {
    None,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Refunded
}

struct Order {
    uint256 id;
    address trader;
    Side side;
    euint64 encPrice;
    euint64 encSize;
    OrderStatus status;
    uint64 createdAt;
}
