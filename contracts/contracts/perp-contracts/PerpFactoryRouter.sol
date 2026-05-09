// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { PerpCoreFactory } from "./PerpCoreFactory.sol";
import { PerpMarketFactory } from "./PerpMarketFactory.sol";

contract PerpFactoryRouter {
    address public owner;
    PerpCoreFactory public coreFactory;
    PerpMarketFactory public marketFactory;

    struct SystemView {
        bytes32 key;
        address oracle;
        address positionManager;
        address liquidationEngine;
        address orderBook;
        address matcher;
        address clearing;
        address collateralToken;
        bool exists;
    }

    mapping(bytes32 => bool) public initialized;

    event FactoriesSet(address coreFactory, address marketFactory);
    event SystemInitialized(bytes32 indexed key);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "zero owner");
        owner = owner_;
    }

    function setFactories(address coreFactory_, address marketFactory_) external onlyOwner {
        require(coreFactory_ != address(0) && marketFactory_ != address(0), "zero factory");
        coreFactory = PerpCoreFactory(coreFactory_);
        marketFactory = PerpMarketFactory(marketFactory_);
        emit FactoriesSet(coreFactory_, marketFactory_);
    }

    function initializeSystem(string calldata symbol, address collateralToken, uint256 initialPrice1e8)
        external
        onlyOwner
        returns (bytes32 key)
    {
        key = keccak256(bytes(symbol));
        require(!initialized[key], "already initialized");

        coreFactory.createCoreSystem(symbol, collateralToken, initialPrice1e8);
        marketFactory.createMarket(symbol);

        initialized[key] = true;
        emit SystemInitialized(key);
    }

    function getSystem(bytes32 key) external view returns (SystemView memory v) {
        (
            bytes32 cKey,
            address oracle,
            address positionManager,
            address liquidationEngine,
            address collateralToken,
            bool cExists
        ) = coreFactory.cores(key);
        (bytes32 mKey, address orderBook, address matcher, address clearing, bool mExists) = marketFactory.markets(key);

        v = SystemView({
            key: cKey != bytes32(0) ? cKey : mKey,
            oracle: oracle,
            positionManager: positionManager,
            liquidationEngine: liquidationEngine,
            orderBook: orderBook,
            matcher: matcher,
            clearing: clearing,
            collateralToken: collateralToken,
            exists: cExists && mExists && initialized[key]
        });
    }
}
