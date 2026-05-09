// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { PerpMarketFactory } from "./PerpMarketFactory.sol";
import { PerpOracle } from "./PerpOracle.sol";
import { PerpPositionManager } from "./PerpPositionManager.sol";
import { PerpLiquidationEngine } from "./PerpLiquidationEngine.sol";

contract PerpSystemFactory {
    struct PerpSystem {
        bytes32 key;
        address marketFactory;
        address oracle;
        address positionManager;
        address liquidationEngine;
        bool exists;
    }

    address public owner;
    address public gateway;
    uint256 public systemCount;

    mapping(bytes32 => PerpSystem) public systems;
    mapping(uint256 => bytes32) public systemKeyAt;

    event SystemCreated(bytes32 indexed key, address marketFactory, address oracle, address positionManager, address liquidationEngine);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address owner_, address gateway_) {
        require(owner_ != address(0) && gateway_ != address(0), "zero address");
        owner = owner_;
        gateway = gateway_;
    }

    function createSystem(string calldata symbol, address collateralToken, uint256 initialPrice1e8)
        external
        onlyOwner
        returns (bytes32 key, PerpSystem memory s)
    {
        require(collateralToken != address(0), "zero collateral");
        key = keccak256(bytes(symbol));
        require(!systems[key].exists, "system exists");

        PerpMarketFactory marketFactory = new PerpMarketFactory(owner, gateway);
        PerpOracle oracle = new PerpOracle(owner, initialPrice1e8);
        PerpPositionManager pm = new PerpPositionManager(address(this), collateralToken, address(oracle));
        PerpLiquidationEngine liq = new PerpLiquidationEngine(owner, gateway, address(pm), 500, 50);

        pm.setLiquidationEngine(address(liq));

        s = PerpSystem({
            key: key,
            marketFactory: address(marketFactory),
            oracle: address(oracle),
            positionManager: address(pm),
            liquidationEngine: address(liq),
            exists: true
        });

        systems[key] = s;
        systemKeyAt[systemCount] = key;
        systemCount += 1;

        emit SystemCreated(key, s.marketFactory, s.oracle, s.positionManager, s.liquidationEngine);
    }
}
