// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { PerpMatcher } from "./PerpMatcher.sol";
import { PerpOrderBook } from "./PerpOrderBook.sol";
import { PerpClearing } from "./PerpClearing.sol";

contract PerpMarketFactory {
    struct Market {
        bytes32 key;
        address orderBook;
        address matcher;
        address clearing;
        bool exists;
    }

    address public owner;
    address public gateway;
    uint256 public marketCount;

    mapping(bytes32 => Market) public markets;
    mapping(uint256 => bytes32) public marketKeyAt;

    event MarketCreated(bytes32 indexed key, address orderBook, address matcher, address clearing);
    event GatewayUpdated(address indexed gateway);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address owner_, address gateway_) {
        require(owner_ != address(0) && gateway_ != address(0), "zero address");
        owner = owner_;
        gateway = gateway_;
    }

    function setGateway(address gateway_) external onlyOwner {
        require(gateway_ != address(0), "zero gateway");
        gateway = gateway_;
        emit GatewayUpdated(gateway_);
    }

    function createMarket(string calldata symbol) external onlyOwner returns (bytes32 key, Market memory m) {
        key = keccak256(bytes(symbol));
        require(!markets[key].exists, "market exists");

        PerpClearing clearing = new PerpClearing(address(this));
        PerpMatcher matcher = new PerpMatcher(address(this), gateway);
        PerpOrderBook orderBook = new PerpOrderBook(address(this), address(matcher), address(clearing));

        clearing.setOrderBook(address(orderBook));
        matcher.setOrderBook(address(orderBook));

        m = Market({
            key: key,
            orderBook: address(orderBook),
            matcher: address(matcher),
            clearing: address(clearing),
            exists: true
        });

        markets[key] = m;
        marketKeyAt[marketCount] = key;
        marketCount += 1;

        emit MarketCreated(key, m.orderBook, m.matcher, m.clearing);
    }
}
