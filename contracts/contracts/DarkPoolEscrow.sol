// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IConfidentialERC20Minimal } from "../interfaces/IConfidentialERC20Minimal.sol";
import { Order, Side, OrderStatus } from "./DarkPoolTypes.sol";

interface IDarkPoolMatcher {
    function onOrdersReady(
        uint256 sellOrderId,
        uint256 buyOrderId,
        euint64 sellPrice,
        euint64 buyPrice,
        euint64 sellSize,
        euint64 buySize
    ) external;
}

contract DarkPoolEscrow is ZamaEthereumConfig {
    IConfidentialERC20Minimal public immutable cTokenA;
    IConfidentialERC20Minimal public immutable cTokenB;
    IDarkPoolMatcher public matcher;
    bool public immutable testingMode;

    uint256 public nextOrderId = 1;
    bool public matchInFlight;

    uint256[] private _sellQueue;
    uint256[] private _buyQueue;
    uint256 public sellHead;
    uint256 public buyHead;

    mapping(uint256 => Order) public orders;

    event SellOrderSubmitted(uint256 indexed orderId, address indexed seller);
    event BuyOrderSubmitted(uint256 indexed orderId, address indexed buyer);
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event MatchTriggered(uint256 indexed sellOrderId, uint256 indexed buyOrderId);
    event RemainderRequeued(uint256 indexed oldOrderId, uint256 indexed newOrderId);

    modifier onlyMatcher() {
        require(msg.sender == address(matcher), "only matcher");
        _;
    }

    constructor(address _cTokenA, address _cTokenB, address _matcher, bool _testingMode) {
        require(_cTokenA != address(0) && _cTokenB != address(0) && _matcher != address(0), "zero address");
        cTokenA = IConfidentialERC20Minimal(_cTokenA);
        cTokenB = IConfidentialERC20Minimal(_cTokenB);
        matcher = IDarkPoolMatcher(_matcher);
        testingMode = _testingMode;
    }

    function setMatcher(address _matcher) external {
        require(address(matcher) == address(0) || msg.sender == address(matcher), "unauthorized");
        matcher = IDarkPoolMatcher(_matcher);
    }

    function sellQueueLength() external view returns (uint256) {
        return _sellQueue.length - sellHead;
    }

    function buyQueueLength() external view returns (uint256) {
        return _buyQueue.length - buyHead;
    }

    function rotateSellHead() external onlyMatcher {
        uint256 headOrderId = activeSellOrderId();
        require(headOrderId != 0, "no sell head");
        _sellQueue.push(headOrderId);
        sellHead++;
    }

    function rotateBuyHead() external onlyMatcher {
        uint256 headOrderId = activeBuyOrderId();
        require(headOrderId != 0, "no buy head");
        _buyQueue.push(headOrderId);
        buyHead++;
    }

    function activeSellOrderId() public view returns (uint256) {
        if (sellHead >= _sellQueue.length) return 0;
        return _sellQueue[sellHead];
    }

    function activeBuyOrderId() public view returns (uint256) {
        if (buyHead >= _buyQueue.length) return 0;
        return _buyQueue[buyHead];
    }

    function submitSellOrder(
        externalEuint64 encMinPrice,
        bytes calldata priceProof,
        externalEuint64 encSellSize,
        bytes calldata sizeProof
    ) external returns (uint256 orderId) {
        euint64 minPrice = FHE.fromExternal(encMinPrice, priceProof);
        euint64 sellSize = FHE.fromExternal(encSellSize, sizeProof);
        orderId = _submitSellOrder(msg.sender, minPrice, sellSize, true);
    }

    function submitSellOrderTest(uint64 minPriceClear, uint64 sellSizeClear) external returns (uint256 orderId) {
        require(testingMode, "testing disabled");
        euint64 minPrice = euint64.wrap(bytes32(uint256(minPriceClear)));
        euint64 sellSize = euint64.wrap(bytes32(uint256(sellSizeClear)));
        orderId = _submitSellOrder(msg.sender, minPrice, sellSize, false);
    }

    function submitBuyOrder(
        externalEuint64 encBidPrice,
        bytes calldata priceProof,
        externalEuint64 encBuySize,
        bytes calldata sizeProof
    ) external returns (uint256 orderId) {
        euint64 bidPrice = FHE.fromExternal(encBidPrice, priceProof);
        euint64 buySize = FHE.fromExternal(encBuySize, sizeProof);
        orderId = _submitBuyOrder(msg.sender, bidPrice, buySize, true);
    }

    function submitBuyOrderTest(uint64 bidPriceClear, uint64 buySizeClear) external returns (uint256 orderId) {
        require(testingMode, "testing disabled");
        euint64 bidPrice = euint64.wrap(bytes32(uint256(bidPriceClear)));
        euint64 buySize = euint64.wrap(bytes32(uint256(buySizeClear)));
        orderId = _submitBuyOrder(msg.sender, bidPrice, buySize, false);
    }

    function cancelOrder(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(order.trader == msg.sender, "not trader");
        require(order.status == OrderStatus.Open || order.status == OrderStatus.PartiallyFilled, "not open");

        order.status = OrderStatus.Cancelled;

        if (order.side == Side.Sell) {
            cTokenA.confidentialTransfer(order.trader, order.encSize);
        } else {
            cTokenB.confidentialTransfer(order.trader, order.encSize);
        }
    }

    function consumeHeadOrders() external view onlyMatcher returns (Order memory sellOrder, Order memory buyOrder) {
        sellOrder = orders[activeSellOrderId()];
        buyOrder = orders[activeBuyOrderId()];
    }

    function fillBoth(uint256 sellOrderId, uint256 buyOrderId) external onlyMatcher {
        require(activeSellOrderId() == sellOrderId && activeBuyOrderId() == buyOrderId, "not queue head");
        orders[sellOrderId].status = OrderStatus.Filled;
        orders[buyOrderId].status = OrderStatus.Filled;
        sellHead++;
        buyHead++;
    }

    function noMatchBoth(uint256 sellOrderId, uint256 buyOrderId) external onlyMatcher {
        require(activeSellOrderId() == sellOrderId && activeBuyOrderId() == buyOrderId, "not queue head");
        orders[sellOrderId].status = OrderStatus.Refunded;
        orders[buyOrderId].status = OrderStatus.Refunded;

        cTokenA.confidentialTransfer(orders[sellOrderId].trader, orders[sellOrderId].encSize);
        cTokenB.confidentialTransfer(orders[buyOrderId].trader, orders[buyOrderId].encSize);

        sellHead++;
        buyHead++;
    }

    function fillBuyRequeueSell(uint256 sellOrderId, uint256 buyOrderId, euint64 sellRemainder)
        external
        onlyMatcher
        returns (uint256 newSellOrderId)
    {
        return _fillBuyRequeueSell(sellOrderId, buyOrderId, sellRemainder);
    }

    function _fillBuyRequeueSell(uint256 sellOrderId, uint256 buyOrderId, euint64 sellRemainder)
        internal
        returns (uint256 newSellOrderId)
    {
        require(activeSellOrderId() == sellOrderId && activeBuyOrderId() == buyOrderId, "not queue head");
        orders[sellOrderId].status = OrderStatus.PartiallyFilled;
        orders[buyOrderId].status = OrderStatus.Filled;

        newSellOrderId = nextOrderId++;
        orders[newSellOrderId] = Order({
            id: newSellOrderId,
            trader: orders[sellOrderId].trader,
            side: Side.Sell,
            encPrice: orders[sellOrderId].encPrice,
            encSize: sellRemainder,
            status: OrderStatus.Open,
            createdAt: uint64(block.timestamp)
        });

        _sellQueue[sellHead] = newSellOrderId;
        buyHead++;

        if (!testingMode) {
            FHE.allowThis(sellRemainder);
        }

        emit RemainderRequeued(sellOrderId, newSellOrderId);
    }

    function fillSellRequeueBuy(uint256 sellOrderId, uint256 buyOrderId, euint64 buyRemainder)
        external
        onlyMatcher
        returns (uint256 newBuyOrderId)
    {
        return _fillSellRequeueBuy(sellOrderId, buyOrderId, buyRemainder);
    }

    function _fillSellRequeueBuy(uint256 sellOrderId, uint256 buyOrderId, euint64 buyRemainder)
        internal
        returns (uint256 newBuyOrderId)
    {
        require(activeSellOrderId() == sellOrderId && activeBuyOrderId() == buyOrderId, "not queue head");
        orders[sellOrderId].status = OrderStatus.Filled;
        orders[buyOrderId].status = OrderStatus.PartiallyFilled;

        newBuyOrderId = nextOrderId++;
        orders[newBuyOrderId] = Order({
            id: newBuyOrderId,
            trader: orders[buyOrderId].trader,
            side: Side.Buy,
            encPrice: orders[buyOrderId].encPrice,
            encSize: buyRemainder,
            status: OrderStatus.Open,
            createdAt: uint64(block.timestamp)
        });

        _buyQueue[buyHead] = newBuyOrderId;
        sellHead++;

        if (!testingMode) {
            FHE.allowThis(buyRemainder);
        }

        emit RemainderRequeued(buyOrderId, newBuyOrderId);
    }

    function fillBuyRequeueSellClear(uint256 sellOrderId, uint256 buyOrderId, uint64 sellRemainderClear)
        external
        onlyMatcher
        returns (uint256)
    {
        require(testingMode, "testing disabled");
        return _fillBuyRequeueSell(sellOrderId, buyOrderId, euint64.wrap(bytes32(uint256(sellRemainderClear))));
    }

    function fillSellRequeueBuyClear(uint256 sellOrderId, uint256 buyOrderId, uint64 buyRemainderClear)
        external
        onlyMatcher
        returns (uint256)
    {
        require(testingMode, "testing disabled");
        return _fillSellRequeueBuy(sellOrderId, buyOrderId, euint64.wrap(bytes32(uint256(buyRemainderClear))));
    }

    function releaseMatchLockAndTryNext() external onlyMatcher {
        matchInFlight = false;
        _triggerMatchIfReady();
    }

    function _triggerMatchIfReady() internal {
        if (matchInFlight) return;

        uint256 sellId = activeSellOrderId();
        uint256 buyId = activeBuyOrderId();
        if (sellId == 0 || buyId == 0) return;

        Order storage sellOrder = orders[sellId];
        Order storage buyOrder = orders[buyId];

        matchInFlight = true;
        emit MatchTriggered(sellId, buyId);
        matcher.onOrdersReady(sellId, buyId, sellOrder.encPrice, buyOrder.encPrice, sellOrder.encSize, buyOrder.encSize);
    }

    function _submitSellOrder(address trader, euint64 minPrice, euint64 sellSize, bool transferIn)
        internal
        returns (uint256 orderId)
    {
        orderId = nextOrderId++;
        orders[orderId] = Order({
            id: orderId,
            trader: trader,
            side: Side.Sell,
            encPrice: minPrice,
            encSize: sellSize,
            status: OrderStatus.Open,
            createdAt: uint64(block.timestamp)
        });
        _sellQueue.push(orderId);

        if (!testingMode) {
            FHE.allowThis(minPrice);
            FHE.allowThis(sellSize);
        }

        if (transferIn) {
            cTokenA.confidentialTransferFrom(trader, address(this), sellSize);
        }

        emit SellOrderSubmitted(orderId, trader);
        _triggerMatchIfReady();
    }

    function _submitBuyOrder(address trader, euint64 bidPrice, euint64 buySize, bool transferIn)
        internal
        returns (uint256 orderId)
    {
        orderId = nextOrderId++;
        orders[orderId] = Order({
            id: orderId,
            trader: trader,
            side: Side.Buy,
            encPrice: bidPrice,
            encSize: buySize,
            status: OrderStatus.Open,
            createdAt: uint64(block.timestamp)
        });
        _buyQueue.push(orderId);

        if (!testingMode) {
            FHE.allowThis(bidPrice);
            FHE.allowThis(buySize);
        }

        if (transferIn) {
            cTokenB.confidentialTransferFrom(trader, address(this), buySize);
        }

        emit BuyOrderSubmitted(orderId, trader);
        _triggerMatchIfReady();
    }
}
