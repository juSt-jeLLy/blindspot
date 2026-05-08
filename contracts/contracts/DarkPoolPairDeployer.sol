// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { DarkPoolEscrow } from "./DarkPoolEscrow.sol";
import { DarkPoolMatcher } from "./DarkPoolMatcher.sol";
import { DarkPoolSettlement } from "./DarkPoolSettlement.sol";

contract DarkPoolPairDeployer is Ownable {
    constructor(address owner_) Ownable(owner_) {}

    function deployPair(address cTokenA, address cTokenB, address gateway)
        external
        onlyOwner
        returns (address escrow, address matcher, address settlement)
    {
        DarkPoolSettlement s = new DarkPoolSettlement(cTokenA, cTokenB);
        DarkPoolMatcher m = new DarkPoolMatcher(address(s), gateway);
        DarkPoolEscrow e = new DarkPoolEscrow(cTokenA, cTokenB, address(m));

        m.setEscrow(address(e));
        s.setMatcher(address(m));

        return (address(e), address(m), address(s));
    }
}
