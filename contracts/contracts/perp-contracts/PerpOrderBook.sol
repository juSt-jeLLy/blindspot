// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { PerpOrder, PerpSide, PerpOrderStatus } from "./PerpTypes.sol";
import { PerpMatcher } from "./PerpMatcher.sol";
import { PerpClearing } from "./PerpClearing.sol";

contract PerpOrderBook is ZamaEthereumConfig {
    uint256 public nextOrderId = 1;
    bool public matchInFlight;

    uint256[] private _longQueue;
    uint256[] private _shortQueue;
    uint256 public longHead;
    uint256 public shortHead;

    mapping(uint256 => PerpOrder) public orders;

    address public owner;
    PerpMatcher public matcher;
    PerpClearing public clearing;

    event LongOrderSubmitted(uint256 indexed orderId, address indexed trader);
    event ShortOrderSubmitted(uint256 indexed orderId, address indexed trader);
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event MatchTriggered(uint256 indexed longOrderId, uint256 indexed shortOrderId);
    event RemainderRequeued(uint256 indexed oldOrderId, uint256 indexed newOrderId);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyMatcher() {
        require(msg.sender == address(matcher), "only matcher");
        _;
    }

    constructor(address owner_, address matcher_, address clearing_) {
        require(owner_ != address(0) && matcher_ != address(0) && clearing_ != address(0), "zero address");
        owner = owner_;
        matcher = PerpMatcher(matcher_);
        clearing = PerpClearing(clearing_);
    }

    function setMatcher(address matcher_) external onlyOwner {
        require(matcher_ != address(0), "zero matcher");
        matcher = PerpMatcher(matcher_);
    }

    function setClearing(address clearing_) external onlyOwner {
        require(clearing_ != address(0), "zero clearing");
        clearing = PerpClearing(clearing_);
    }

    function longQueueLength() external view returns (uint256) {
        return _longQueue.length - longHead;
    }

    function shortQueueLength() external view returns (uint256) {
        return _shortQueue.length - shortHead;
    }

    function activeLongOrderId() public view returns (uint256) {
        if (longHead >= _longQueue.length) return 0;
        return _longQueue[longHead];
    }

    function activeShortOrderId() public view returns (uint256) {
        if (shortHead >= _shortQueue.length) return 0;
        return _shortQueue[shortHead];
    }

    function submitLongOrder(
        externalEuint64 encLimitPrice,
        bytes calldata priceProof,
        externalEuint64 encSize,
        bytes calldata sizeProof
    ) external returns (uint256 orderId) {
        euint64 limitPrice = FHE.fromExternal(encLimitPrice, priceProof);
        euint64 size = FHE.fromExternal(encSize, sizeProof);
        orderId = _submitOrder(msg.sender, PerpSide.Long, limitPrice, size);
        emit LongOrderSubmitted(orderId, msg.sender);
    }

    function submitShortOrder(
        externalEuint64 encLimitPrice,
        bytes calldata priceProof,
        externalEuint64 encSize,
        bytes calldata sizeProof
    ) external returns (uint256 orderId) {
        euint64 limitPrice = FHE.fromExternal(encLimitPrice, priceProof);
        euint64 size = FHE.fromExternal(encSize, sizeProof);
        orderId = _submitOrder(msg.sender, PerpSide.Short, limitPrice, size);
        emit ShortOrderSubmitted(orderId, msg.sender);
    }

    function cancelOrder(uint256 orderId) external {
        PerpOrder storage o = orders[orderId];
        require(o.trader == msg.sender, "not trader");
        require(o.status == PerpOrderStatus.Open || o.status == PerpOrderStatus.PartiallyFilled, "not open");
        o.status = PerpOrderStatus.Cancelled;
        emit OrderCancelled(orderId, msg.sender);
    }

    function onResolved(
        uint256,
        bool matched,
        bool shortIsSmaller,
        uint64 fillSizeClear,
        uint64 longRemainderClear,
        uint64 shortRemainderClear
    ) external onlyMatcher {
        uint256 longId = activeLongOrderId();
        uint256 shortId = activeShortOrderId();
        require(longId != 0 && shortId != 0, "empty queue");

        if (!matched) {
            shortHead += 1;
            matchInFlight = false;
            _triggerMatchIfReady();
            return;
        }

        euint64 fillSize = FHE.asEuint64(fillSizeClear);
        FHE.allowTransient(fillSize, address(clearing));
        clearing.applyTrade(orders[longId].trader, orders[shortId].trader, fillSize);

        if (shortIsSmaller && longRemainderClear > 0) {
            orders[longId].status = PerpOrderStatus.PartiallyFilled;
            orders[shortId].status = PerpOrderStatus.Filled;

            uint256 newLongId = _spawnRemainderOrder(longId, PerpSide.Long, FHE.asEuint64(longRemainderClear));
            _longQueue[longHead] = newLongId;
            shortHead += 1;
            emit RemainderRequeued(longId, newLongId);
        } else if (!shortIsSmaller && shortRemainderClear > 0) {
            orders[longId].status = PerpOrderStatus.Filled;
            orders[shortId].status = PerpOrderStatus.PartiallyFilled;

            uint256 newShortId = _spawnRemainderOrder(shortId, PerpSide.Short, FHE.asEuint64(shortRemainderClear));
            _shortQueue[shortHead] = newShortId;
            longHead += 1;
            emit RemainderRequeued(shortId, newShortId);
        } else {
            orders[longId].status = PerpOrderStatus.Filled;
            orders[shortId].status = PerpOrderStatus.Filled;
            longHead += 1;
            shortHead += 1;
        }

        matchInFlight = false;
        _triggerMatchIfReady();
    }

    function _submitOrder(address trader, PerpSide side, euint64 limitPrice, euint64 size)
        internal
        returns (uint256 orderId)
    {
        orderId = nextOrderId++;
        orders[orderId] = PerpOrder({
            id: orderId,
            trader: trader,
            side: side,
            encLimitPrice: limitPrice,
            encSize: size,
            status: PerpOrderStatus.Open,
            createdAt: uint64(block.timestamp)
        });

        FHE.allowThis(limitPrice);
        FHE.allowThis(size);
        FHE.allow(limitPrice, trader);
        FHE.allow(size, trader);
        FHE.allow(limitPrice, address(matcher));
        FHE.allow(size, address(matcher));

        if (side == PerpSide.Long) {
            _longQueue.push(orderId);
        } else {
            _shortQueue.push(orderId);
        }

        _triggerMatchIfReady();
    }

    function _spawnRemainderOrder(uint256 oldOrderId, PerpSide side, euint64 remainderSize)
        internal
        returns (uint256 newOrderId)
    {
        PerpOrder storage oldOrder = orders[oldOrderId];

        newOrderId = nextOrderId++;
        orders[newOrderId] = PerpOrder({
            id: newOrderId,
            trader: oldOrder.trader,
            side: side,
            encLimitPrice: oldOrder.encLimitPrice,
            encSize: remainderSize,
            status: PerpOrderStatus.Open,
            createdAt: uint64(block.timestamp)
        });

        FHE.allowThis(remainderSize);
        FHE.allow(remainderSize, oldOrder.trader);
        FHE.allow(remainderSize, address(matcher));
    }

    function _triggerMatchIfReady() internal {
        if (matchInFlight) return;

        uint256 longId = activeLongOrderId();
        uint256 shortId = activeShortOrderId();
        if (longId == 0 || shortId == 0) return;

        PerpOrder storage longOrder = orders[longId];
        PerpOrder storage shortOrder = orders[shortId];

        matchInFlight = true;
        emit MatchTriggered(longId, shortId);

        matcher.requestMatch(
            longId,
            shortId,
            longOrder.encLimitPrice,
            shortOrder.encLimitPrice,
            longOrder.encSize,
            shortOrder.encSize
        );
    }
}
