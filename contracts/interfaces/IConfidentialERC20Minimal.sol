// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";

interface IConfidentialERC20Minimal {
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);
}
