// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { IConfidentialERC20Minimal } from "../interfaces/IConfidentialERC20Minimal.sol";

contract DarkPoolSettlement {
    IConfidentialERC20Minimal public immutable cTokenA;
    IConfidentialERC20Minimal public immutable cTokenB;
    address public matcher;

    event Settled(address indexed seller, address indexed buyer, uint256 sellOrderId, uint256 buyOrderId);

    modifier onlyMatcher() {
        require(msg.sender == matcher, "only matcher");
        _;
    }

    constructor(address _cTokenA, address _cTokenB) {
        require(_cTokenA != address(0) && _cTokenB != address(0), "zero address");
        cTokenA = IConfidentialERC20Minimal(_cTokenA);
        cTokenB = IConfidentialERC20Minimal(_cTokenB);
    }

    function setMatcher(address _matcher) external {
        require(matcher == address(0) || msg.sender == matcher, "unauthorized");
        matcher = _matcher;
    }

    function settle(
        address seller,
        address buyer,
        uint256 sellOrderId,
        uint256 buyOrderId,
        euint64 fillSize
    ) external onlyMatcher {
        cTokenA.confidentialTransfer(buyer, fillSize);
        cTokenB.confidentialTransfer(seller, fillSize);
        emit Settled(seller, buyer, sellOrderId, buyOrderId);
    }
}
