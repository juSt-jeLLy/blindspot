// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { PerpOracle } from "./PerpOracle.sol";
import { PerpPositionManager } from "./PerpPositionManager.sol";
import { PerpLiquidationEngine } from "./PerpLiquidationEngine.sol";

contract PerpCoreFactory {
    struct CoreSystem {
        bytes32 key;
        address oracle;
        address positionManager;
        address liquidationEngine;
        address collateralToken;
        bool exists;
    }

    address public owner;
    address public gateway;
    uint256 public coreCount;

    mapping(bytes32 => CoreSystem) public cores;
    mapping(uint256 => bytes32) public coreKeyAt;

    event CoreCreated(bytes32 indexed key, address oracle, address positionManager, address liquidationEngine, address collateralToken);

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
    }

    function createCoreSystem(string calldata symbol, address collateralToken, uint256 initialPrice1e8)
        external
        onlyOwner
        returns (bytes32 key, CoreSystem memory c)
    {
        require(collateralToken != address(0), "zero collateral");
        key = keccak256(bytes(symbol));
        require(!cores[key].exists, "core exists");

        PerpOracle oracle = new PerpOracle(owner, initialPrice1e8);
        PerpPositionManager pm = new PerpPositionManager(address(this), collateralToken, address(oracle));
        PerpLiquidationEngine liq = new PerpLiquidationEngine(owner, gateway, address(pm), 500, 50);

        pm.setLiquidationEngine(address(liq));

        c = CoreSystem({
            key: key,
            oracle: address(oracle),
            positionManager: address(pm),
            liquidationEngine: address(liq),
            collateralToken: collateralToken,
            exists: true
        });

        cores[key] = c;
        coreKeyAt[coreCount] = key;
        coreCount += 1;

        emit CoreCreated(key, c.oracle, c.positionManager, c.liquidationEngine, collateralToken);
    }
}
