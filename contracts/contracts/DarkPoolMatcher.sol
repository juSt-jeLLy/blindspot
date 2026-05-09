// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, ebool, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { DarkPoolSettlement } from "./DarkPoolSettlement.sol";
import { Order } from "./DarkPoolTypes.sol";

interface IDarkPoolEscrowMatcherSide {
    function consumeHeadOrders() external view returns (Order memory sellOrder, Order memory buyOrder);
    function fillBoth(uint256 sellOrderId, uint256 buyOrderId) external;
    function fillBuyRequeueSell(uint256 sellOrderId, uint256 buyOrderId, euint64 sellRemainder) external returns (uint256);
    function fillSellRequeueBuy(uint256 sellOrderId, uint256 buyOrderId, euint64 buyRemainder) external returns (uint256);
    function buyQueueLength() external view returns (uint256);
    function rotateSellHead() external;
    function rotateBuyHead() external;
    function releaseMatchLockAndTryNext() external;
    function settleTransfer(address seller, address buyer, euint64 fillSize) external;
}

contract DarkPoolMatcher is ZamaEthereumConfig {
    struct PendingMatch {
        uint256 sellOrderId;
        uint256 buyOrderId;
        address seller;
        address buyer;
        bytes32 priceMatchedHandle;
        bytes32 buyIsSmallerHandle;
        bytes32 fillSizeHandle;
        bytes32 sellRemainderHandle;
        bytes32 buyRemainderHandle;
        bool exists;
    }

    IDarkPoolEscrowMatcherSide public escrow;
    DarkPoolSettlement public immutable settlement;
    address public owner;
    address public gateway;
    uint256 public nextRequestId = 1;
    uint256 public scanSellOrderId;
    uint256 public scanAttempts;

    mapping(uint256 => PendingMatch) public pendingMatches;

    event MatchRequested(uint256 indexed requestId, uint256 indexed sellOrderId, uint256 indexed buyOrderId);
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

    constructor(address settlementAddress, address gatewayAddress) {
        require(settlementAddress != address(0), "zero settlement");
        require(gatewayAddress != address(0), "zero gateway");
        settlement = DarkPoolSettlement(settlementAddress);
        owner = msg.sender;
        gateway = gatewayAddress;
    }

    function setEscrow(address escrowAddress) external {
        require(address(escrow) == address(0) || msg.sender == owner, "unauthorized");
        escrow = IDarkPoolEscrowMatcherSide(escrowAddress);
    }

    function setGateway(address gatewayAddress) external onlyOwner {
        require(gatewayAddress != address(0), "zero gateway");
        gateway = gatewayAddress;
    }

    function getPendingHandles(uint256 requestId) external view returns (bytes32[] memory handles) {
        PendingMatch memory p = pendingMatches[requestId];
        require(p.exists, "invalid request");
        handles = new bytes32[](5);
        handles[0] = p.priceMatchedHandle;
        handles[1] = p.buyIsSmallerHandle;
        handles[2] = p.fillSizeHandle;
        handles[3] = p.sellRemainderHandle;
        handles[4] = p.buyRemainderHandle;
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
        FHE.makePubliclyDecryptable(priceMatched);
        FHE.makePubliclyDecryptable(buyIsSmaller);
        FHE.makePubliclyDecryptable(fillSize);
        FHE.makePubliclyDecryptable(sellRemainder);
        FHE.makePubliclyDecryptable(buyRemainder);

        uint256 requestId = nextRequestId++;
        pendingMatches[requestId] = PendingMatch({
            sellOrderId: sellOrderId,
            buyOrderId: buyOrderId,
            seller: sellOrder.trader,
            buyer: buyOrder.trader,
            priceMatchedHandle: ebool.unwrap(priceMatched),
            buyIsSmallerHandle: ebool.unwrap(buyIsSmaller),
            fillSizeHandle: euint64.unwrap(fillSize),
            sellRemainderHandle: euint64.unwrap(sellRemainder),
            buyRemainderHandle: euint64.unwrap(buyRemainder),
            exists: true
        });

        emit MatchRequested(requestId, sellOrderId, buyOrderId);
    }

    function resolveMatchWithProof(uint256 requestId, bytes calldata cleartexts, bytes calldata decryptionProof)
        external
        onlyGateway
    {
        PendingMatch memory pending = pendingMatches[requestId];
        require(pending.exists, "invalid request");

        bytes32[] memory handles = new bytes32[](5);
        handles[0] = pending.priceMatchedHandle;
        handles[1] = pending.buyIsSmallerHandle;
        handles[2] = pending.fillSizeHandle;
        handles[3] = pending.sellRemainderHandle;
        handles[4] = pending.buyRemainderHandle;

        // Verifies KMS signatures/proof against exact ciphertext handles and decoded cleartexts payload.
        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        (bool matched, bool buyIsSmaller, uint64 fillSizeClear, uint64 sellRemainderClear, uint64 buyRemainderClear) =
            abi.decode(cleartexts, (bool, bool, uint64, uint64, uint64));

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
                escrow.rotateBuyHead();
            } else {
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

        euint64 fillSize = FHE.asEuint64(fillSizeClear);
        FHE.allowTransient(fillSize, address(escrow));
        escrow.settleTransfer(pending.seller, pending.buyer, fillSize);

        if (buyIsSmaller && sellRemainderClear > 0) {
            uint256 remainderId = escrow.fillBuyRequeueSell(
                pending.sellOrderId,
                pending.buyOrderId,
                FHE.asEuint64(sellRemainderClear)
            );
            emit PartialFill(requestId, pending.buyOrderId, remainderId);
        } else if (!buyIsSmaller && buyRemainderClear > 0) {
            uint256 remainderId = escrow.fillSellRequeueBuy(
                pending.sellOrderId,
                pending.buyOrderId,
                FHE.asEuint64(buyRemainderClear)
            );
            emit PartialFill(requestId, pending.sellOrderId, remainderId);
        } else {
            escrow.fillBoth(pending.sellOrderId, pending.buyOrderId);
        }

        escrow.releaseMatchLockAndTryNext();
        emit MatchResolved(requestId, true);
    }
}
