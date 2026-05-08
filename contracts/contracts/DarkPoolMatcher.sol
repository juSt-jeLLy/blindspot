// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, ebool, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { DarkPoolSettlement } from "./DarkPoolSettlement.sol";
import { Order } from "./DarkPoolTypes.sol";

interface IDarkPoolEscrowMatcherSide {
    function consumeHeadOrders() external view returns (Order memory sellOrder, Order memory buyOrder);
    function fillBoth(uint256 sellOrderId, uint256 buyOrderId) external;
    function noMatchBoth(uint256 sellOrderId, uint256 buyOrderId) external;
    function fillBuyRequeueSell(uint256 sellOrderId, uint256 buyOrderId, euint64 sellRemainder) external returns (uint256);
    function fillSellRequeueBuy(uint256 sellOrderId, uint256 buyOrderId, euint64 buyRemainder) external returns (uint256);
    function fillBuyRequeueSellClear(uint256 sellOrderId, uint256 buyOrderId, uint64 sellRemainderClear) external returns (uint256);
    function fillSellRequeueBuyClear(uint256 sellOrderId, uint256 buyOrderId, uint64 buyRemainderClear) external returns (uint256);
    function buyQueueLength() external view returns (uint256);
    function rotateSellHead() external;
    function rotateBuyHead() external;
    function releaseMatchLockAndTryNext() external;
}

contract DarkPoolMatcher is ZamaEthereumConfig {
    struct PendingMatch {
        uint256 sellOrderId;
        uint256 buyOrderId;
        address seller;
        address buyer;
        bool exists;
    }

    IDarkPoolEscrowMatcherSide public escrow;
    DarkPoolSettlement public immutable settlement;
    address public owner;
    address public gateway;
    bool public immutable testingMode;
    uint256 public nextRequestId = 1;
    uint256 public scanSellOrderId;
    uint256 public scanAttempts;

    mapping(uint256 => PendingMatch) public pendingMatches;

    event MatchRequested(
        uint256 indexed requestId,
        uint256 indexed sellOrderId,
        uint256 indexed buyOrderId,
        ebool priceMatched,
        ebool buyIsSmaller,
        euint64 fillSize,
        euint64 sellRemainder,
        euint64 buyRemainder
    );
    event MatchResolved(uint256 indexed requestId, bool matched);
    event PartialFill(uint256 indexed requestId, uint256 indexed smallerOrderId, uint256 indexed remainderOrderId);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyGateway() {
        require(msg.sender == gateway, "only gateway");
        _;
    }

    constructor(address settlementAddress, address gatewayAddress, bool _testingMode) {
        require(settlementAddress != address(0), "zero settlement");
        require(gatewayAddress != address(0), "zero gateway");
        settlement = DarkPoolSettlement(settlementAddress);
        owner = msg.sender;
        gateway = gatewayAddress;
        testingMode = _testingMode;
    }

    function setEscrow(address escrowAddress) external {
        require(address(escrow) == address(0) || msg.sender == owner, "unauthorized");
        escrow = IDarkPoolEscrowMatcherSide(escrowAddress);
    }

    function setGateway(address gatewayAddress) external onlyOwner {
        require(gatewayAddress != address(0), "zero gateway");
        gateway = gatewayAddress;
    }

    function onOrdersReady(
        uint256 sellOrderId,
        uint256 buyOrderId,
        euint64 sellPrice,
        euint64 buyPrice,
        euint64 sellSize,
        euint64 buySize
    ) external {
        require(msg.sender == address(escrow), "only escrow");

        (Order memory sellOrder, Order memory buyOrder) = escrow.consumeHeadOrders();
        require(sellOrder.id == sellOrderId && buyOrder.id == buyOrderId, "stale orders");

        if (testingMode) {
            uint256 requestIdTest = nextRequestId++;
            pendingMatches[requestIdTest] = PendingMatch({
                sellOrderId: sellOrderId,
                buyOrderId: buyOrderId,
                seller: sellOrder.trader,
                buyer: buyOrder.trader,
                exists: true
            });
            return;
        }

        ebool priceMatched = FHE.ge(buyPrice, sellPrice);
        ebool buyIsSmaller = FHE.le(buySize, sellSize);
        euint64 fillSize = FHE.select(buyIsSmaller, buySize, sellSize);
        euint64 sellRemainder = FHE.sub(sellSize, fillSize);
        euint64 buyRemainder = FHE.sub(buySize, fillSize);

        FHE.allowThis(priceMatched);
        FHE.allowThis(buyIsSmaller);
        FHE.allowThis(fillSize);
        FHE.allowThis(sellRemainder);
        FHE.allowThis(buyRemainder);

        uint256 requestId = nextRequestId++;
        pendingMatches[requestId] = PendingMatch({
            sellOrderId: sellOrderId,
            buyOrderId: buyOrderId,
            seller: sellOrder.trader,
            buyer: buyOrder.trader,
            exists: true
        });

        emit MatchRequested(requestId, sellOrderId, buyOrderId, priceMatched, buyIsSmaller, fillSize, sellRemainder, buyRemainder);
    }

    function resolveMatch(
        uint256 requestId,
        bool matched,
        bool buyIsSmaller,
        uint64 fillSizeClear,
        uint64 sellRemainderClear,
        uint64 buyRemainderClear
    ) external onlyGateway {
        PendingMatch memory pending = pendingMatches[requestId];
        require(pending.exists, "invalid request");
        delete pendingMatches[requestId];

        if (!matched) {
            uint256 buyLen = escrow.buyQueueLength();
            if (scanSellOrderId != pending.sellOrderId) {
                scanSellOrderId = pending.sellOrderId;
                scanAttempts = 1;
            } else {
                scanAttempts += 1;
            }

            if (buyLen > 0 && scanAttempts < buyLen) {
                // Change one side: keep current sell candidate, rotate buy head.
                escrow.rotateBuyHead();
            } else {
                // Full loop over opposite side completed: keep pending and rotate sell candidate.
                escrow.rotateSellHead();
                scanSellOrderId = 0;
                scanAttempts = 0;
            }

            escrow.releaseMatchLockAndTryNext();
            emit MatchResolved(requestId, false);
            return;
        }

        scanSellOrderId = 0;
        scanAttempts = 0;

        if (!testingMode) {
            euint64 fillSize = FHE.asEuint64(fillSizeClear);
            settlement.settle(pending.seller, pending.buyer, pending.sellOrderId, pending.buyOrderId, fillSize);
        }

        if (buyIsSmaller && sellRemainderClear > 0) {
            uint256 remainderId = testingMode
                ? escrow.fillBuyRequeueSellClear(pending.sellOrderId, pending.buyOrderId, sellRemainderClear)
                : escrow.fillBuyRequeueSell(pending.sellOrderId, pending.buyOrderId, FHE.asEuint64(sellRemainderClear));
            emit PartialFill(requestId, pending.buyOrderId, remainderId);
        } else if (!buyIsSmaller && buyRemainderClear > 0) {
            uint256 remainderId = testingMode
                ? escrow.fillSellRequeueBuyClear(pending.sellOrderId, pending.buyOrderId, buyRemainderClear)
                : escrow.fillSellRequeueBuy(pending.sellOrderId, pending.buyOrderId, FHE.asEuint64(buyRemainderClear));
            emit PartialFill(requestId, pending.sellOrderId, remainderId);
        } else {
            escrow.fillBoth(pending.sellOrderId, pending.buyOrderId);
        }

        escrow.releaseMatchLockAndTryNext();
        emit MatchResolved(requestId, true);
    }
}
