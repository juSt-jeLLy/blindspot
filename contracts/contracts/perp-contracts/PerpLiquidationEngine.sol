// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { PerpPositionManager } from "./PerpPositionManager.sol";

contract PerpLiquidationEngine is ZamaEthereumConfig {
    struct PendingLiq {
        address user;
        address liquidator;
        bytes32 signalHandle;
        bool exists;
    }

    PerpPositionManager public immutable positionManager;
    address public owner;
    address public gateway;

    uint16 public maintMarginBps;
    uint16 public rewardBps;
    uint256 public nextRequestId = 1;

    mapping(uint256 => PendingLiq) public pending;

    event LiquidationCheckRequested(uint256 indexed requestId, address indexed user, address indexed liquidator);
    event LiquidationResolved(uint256 indexed requestId, bool liquidated);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyGateway() {
        require(msg.sender == gateway, "only gateway");
        _;
    }

    constructor(address owner_, address gateway_, address positionManager_, uint16 maintMarginBps_, uint16 rewardBps_) {
        require(owner_ != address(0) && gateway_ != address(0) && positionManager_ != address(0), "zero address");
        require(maintMarginBps_ > 0 && maintMarginBps_ <= 10_000, "bad maint");
        require(rewardBps_ <= 1_000, "bad reward");
        owner = owner_;
        gateway = gateway_;
        positionManager = PerpPositionManager(positionManager_);
        maintMarginBps = maintMarginBps_;
        rewardBps = rewardBps_;
    }

    function setGateway(address gateway_) external onlyOwner {
        require(gateway_ != address(0), "zero gateway");
        gateway = gateway_;
    }

    function setRiskParams(uint16 maintMarginBps_, uint16 rewardBps_) external onlyOwner {
        require(maintMarginBps_ > 0 && maintMarginBps_ <= 10_000, "bad maint");
        require(rewardBps_ <= 1_000, "bad reward");
        maintMarginBps = maintMarginBps_;
        rewardBps = rewardBps_;
    }

    function requestLiquidationCheck(address user) external returns (uint256 requestId) {
        bytes32 signal = positionManager.buildLiquidationSignal(user, maintMarginBps);

        requestId = nextRequestId++;
        pending[requestId] = PendingLiq({ user: user, liquidator: msg.sender, signalHandle: signal, exists: true });

        emit LiquidationCheckRequested(requestId, user, msg.sender);
    }

    function getPendingHandles(uint256 requestId) external view returns (bytes32[] memory handles) {
        PendingLiq memory p = pending[requestId];
        require(p.exists, "invalid request");
        handles = new bytes32[](1);
        handles[0] = p.signalHandle;
    }

    function resolveLiquidationWithProof(uint256 requestId, bytes calldata cleartexts, bytes calldata decryptionProof)
        external
        onlyGateway
    {
        PendingLiq memory p = pending[requestId];
        require(p.exists, "invalid request");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = p.signalHandle;

        FHE.checkSignatures(handles, cleartexts, decryptionProof);
        (bool canLiquidate) = abi.decode(cleartexts, (bool));

        delete pending[requestId];

        if (canLiquidate) {
            positionManager.liquidateFromEngine(p.user, p.liquidator, rewardBps);
        }

        emit LiquidationResolved(requestId, canLiquidate);
    }
}
