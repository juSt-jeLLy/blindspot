// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { DarkPoolToken } from "./DarkPoolToken.sol";

contract DarkPoolWrapperDeployer is Ownable {
    constructor(address owner_) Ownable(owner_) {}

    function deployWrapper(address underlying, string calldata name, string calldata symbol)
        external
        onlyOwner
        returns (address)
    {
        DarkPoolToken wrapper = new DarkPoolToken(underlying, name, symbol);
        return address(wrapper);
    }
}
