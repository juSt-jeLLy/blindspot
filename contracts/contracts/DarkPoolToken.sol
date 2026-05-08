// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import { ERC7984ERC20Wrapper } from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DarkPoolToken is ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(address underlyingToken, string memory name_, string memory symbol_)
        ERC7984(name_, symbol_, "")
        ERC7984ERC20Wrapper(IERC20(underlyingToken))
    {}
}
