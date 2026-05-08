// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";

contract MockConfidentialERC20 {
    function confidentialTransfer(address, euint64 amount) external pure returns (euint64 transferred) {
        return amount;
    }

    function confidentialTransferFrom(address, address, euint64 amount) external pure returns (euint64 transferred) {
        return amount;
    }
}
