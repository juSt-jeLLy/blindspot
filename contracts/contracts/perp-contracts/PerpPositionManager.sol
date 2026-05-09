// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, ebool, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { PerpOracle } from "./PerpOracle.sol";
import { IConfidentialERC20Minimal } from "../../interfaces/IConfidentialERC20Minimal.sol";

contract PerpPositionManager is ZamaEthereumConfig {
    struct Position {
        bool isOpen;
        bool isLong;
        uint64 collateralUsdc;
        uint64 entryPrice1e8;
        euint64 size;
        euint64 leverageE6;
    }

    IConfidentialERC20Minimal public immutable collateralToken;
    PerpOracle public immutable oracle;
    address public owner;
    address public liquidationEngine;

    mapping(address => uint64) public freeCollateral;
    mapping(address => Position) internal _positions;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event PositionOpened(address indexed user, bool isLong, uint256 collateralUsdc, uint256 entryPrice1e8);
    event PositionClosed(address indexed user);
    event PositionLiquidated(address indexed user, address indexed liquidator, uint256 rewardUsdc, uint256 price1e8);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyLiquidationEngine() {
        require(msg.sender == liquidationEngine, "only liq engine");
        _;
    }

    constructor(address owner_, address collateralToken_, address oracle_) {
        require(owner_ != address(0) && collateralToken_ != address(0) && oracle_ != address(0), "zero address");
        owner = owner_;
        collateralToken = IConfidentialERC20Minimal(collateralToken_);
        oracle = PerpOracle(oracle_);
    }

    function setLiquidationEngine(address liquidationEngine_) external onlyOwner {
        require(liquidationEngine_ != address(0), "zero liq");
        liquidationEngine = liquidationEngine_;
    }

    function getPosition(address user) external view returns (Position memory) {
        return _positions[user];
    }

    function depositCollateral(uint64 amount) external {
        require(amount > 0, "amount=0");
        euint64 encAmount = FHE.asEuint64(amount);
        FHE.allowTransient(encAmount, address(collateralToken));
        collateralToken.confidentialTransferFrom(msg.sender, address(this), encAmount);
        freeCollateral[msg.sender] += amount;
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint64 amount) external {
        require(amount > 0, "amount=0");
        require(freeCollateral[msg.sender] >= amount, "insufficient free");
        freeCollateral[msg.sender] -= amount;
        euint64 encAmount = FHE.asEuint64(amount);
        FHE.allowTransient(encAmount, address(collateralToken));
        collateralToken.confidentialTransfer(msg.sender, encAmount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function openPosition(
        externalEuint64 encSize,
        bytes calldata sizeProof,
        externalEuint64 encLeverageE6,
        bytes calldata levProof,
        bool isLong,
        uint64 collateralToLock
    ) external {
        Position storage p = _positions[msg.sender];
        require(!p.isOpen, "position exists");
        require(collateralToLock > 0, "bad collateral");
        require(freeCollateral[msg.sender] >= collateralToLock, "insufficient free collateral");

        euint64 size = FHE.fromExternal(encSize, sizeProof);
        euint64 leverageE6 = FHE.fromExternal(encLeverageE6, levProof);

        freeCollateral[msg.sender] -= collateralToLock;

        uint256 px = oracle.getPrice1e8();
        require(px <= type(uint64).max, "price overflow");

        _positions[msg.sender] = Position({
            isOpen: true,
            isLong: isLong,
            collateralUsdc: collateralToLock,
            entryPrice1e8: uint64(px),
            size: size,
            leverageE6: leverageE6
        });

        FHE.allowThis(size);
        FHE.allowThis(leverageE6);
        FHE.allow(size, msg.sender);
        FHE.allow(leverageE6, msg.sender);

        emit PositionOpened(msg.sender, isLong, collateralToLock, px);
    }

    function closePosition() external {
        Position storage p = _positions[msg.sender];
        require(p.isOpen, "no position");

        uint256 collateral = p.collateralUsdc;
        delete _positions[msg.sender];
        freeCollateral[msg.sender] += uint64(collateral);

        emit PositionClosed(msg.sender);
    }

    function buildLiquidationSignal(address user, uint16 maintMarginBps) external onlyLiquidationEngine returns (bytes32) {
        Position storage p = _positions[user];
        require(p.isOpen, "no position");
        require(maintMarginBps > 0 && maintMarginBps <= 10_000, "bad maint");

        euint64 exposure = FHE.div(FHE.mul(p.size, p.leverageE6), 1_000_000);
        euint64 threshold = FHE.div(FHE.mul(exposure, FHE.asEuint64(maintMarginBps)), 10_000);
        ebool liquidatable = FHE.lt(FHE.asEuint64(p.collateralUsdc), threshold);

        FHE.allowThis(liquidatable);
        FHE.makePubliclyDecryptable(liquidatable);

        return ebool.unwrap(liquidatable);
    }

    function liquidateFromEngine(address user, address liquidator, uint16 rewardBps) external onlyLiquidationEngine {
        Position storage p = _positions[user];
        require(p.isOpen, "no position");
        require(rewardBps <= 1_000, "reward too high");

        uint256 collateral = p.collateralUsdc;
        uint256 reward = (collateral * rewardBps) / 10_000;
        delete _positions[user];

        if (reward > 0) {
            euint64 encReward = FHE.asEuint64(uint64(reward));
            FHE.allowTransient(encReward, address(collateralToken));
            collateralToken.confidentialTransfer(liquidator, encReward);
        }

        emit PositionLiquidated(user, liquidator, reward, oracle.getPrice1e8());
    }
}
