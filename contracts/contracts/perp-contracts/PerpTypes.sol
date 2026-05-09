// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";

enum PerpSide {
    Long,
    Short
}

enum PerpOrderStatus {
    None,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled
}

struct PerpOrder {
    uint256 id;
    address trader;
    PerpSide side;
    euint64 encLimitPrice;
    euint64 encSize;
    PerpOrderStatus status;
    uint64 createdAt;
}
