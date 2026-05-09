// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, ebool, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IPerpOrderBookMatcherSide {
    function onResolved(
        uint256 requestId,
        bool matched,
        bool shortIsSmaller,
        uint64 fillSizeClear,
        uint64 longRemainderClear,
        uint64 shortRemainderClear
    ) external;
}

contract PerpMatcher is ZamaEthereumConfig {
    struct PendingMatch {
        uint256 longOrderId;
        uint256 shortOrderId;
        bytes32 priceMatchedHandle;
        bytes32 shortIsSmallerHandle;
        bytes32 fillSizeHandle;
        bytes32 longRemainderHandle;
        bytes32 shortRemainderHandle;
        bool exists;
    }

    address public owner;
    address public gateway;
    address public orderBook;
    uint256 public nextRequestId = 1;

    mapping(uint256 => PendingMatch) public pendingMatches;

    event MatchRequested(uint256 indexed requestId, uint256 indexed longOrderId, uint256 indexed shortOrderId);
    event MatchResolved(uint256 indexed requestId, bool matched);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyGateway() {
        require(msg.sender == gateway, "only gateway");
        _;
    }

    modifier onlyOrderBook() {
        require(msg.sender == orderBook, "only orderbook");
        _;
    }

    constructor(address owner_, address gateway_) {
        require(owner_ != address(0) && gateway_ != address(0), "zero address");
        owner = owner_;
        gateway = gateway_;
    }

    function setOrderBook(address orderBook_) external onlyOwner {
        require(orderBook_ != address(0), "zero orderbook");
        orderBook = orderBook_;
    }

    function setGateway(address gateway_) external onlyOwner {
        require(gateway_ != address(0), "zero gateway");
        gateway = gateway_;
    }

    function requestMatch(
        uint256 longOrderId,
        uint256 shortOrderId,
        euint64 longLimitPrice,
        euint64 shortLimitPrice,
        euint64 longSize,
        euint64 shortSize
    ) external onlyOrderBook returns (uint256 requestId) {
        ebool priceMatched = FHE.ge(longLimitPrice, shortLimitPrice);
        ebool shortIsSmaller = FHE.le(shortSize, longSize);
        euint64 fillSize = FHE.select(shortIsSmaller, shortSize, longSize);
        euint64 longRemainder = FHE.sub(longSize, fillSize);
        euint64 shortRemainder = FHE.sub(shortSize, fillSize);

        FHE.allowThis(priceMatched);
        FHE.allowThis(shortIsSmaller);
        FHE.allowThis(fillSize);
        FHE.allowThis(longRemainder);
        FHE.allowThis(shortRemainder);
        FHE.makePubliclyDecryptable(priceMatched);
        FHE.makePubliclyDecryptable(shortIsSmaller);
        FHE.makePubliclyDecryptable(fillSize);
        FHE.makePubliclyDecryptable(longRemainder);
        FHE.makePubliclyDecryptable(shortRemainder);

        requestId = nextRequestId++;
        pendingMatches[requestId] = PendingMatch({
            longOrderId: longOrderId,
            shortOrderId: shortOrderId,
            priceMatchedHandle: ebool.unwrap(priceMatched),
            shortIsSmallerHandle: ebool.unwrap(shortIsSmaller),
            fillSizeHandle: euint64.unwrap(fillSize),
            longRemainderHandle: euint64.unwrap(longRemainder),
            shortRemainderHandle: euint64.unwrap(shortRemainder),
            exists: true
        });

        emit MatchRequested(requestId, longOrderId, shortOrderId);
    }

    function getPendingHandles(uint256 requestId) external view returns (bytes32[] memory handles) {
        PendingMatch memory p = pendingMatches[requestId];
        require(p.exists, "invalid request");
        handles = new bytes32[](5);
        handles[0] = p.priceMatchedHandle;
        handles[1] = p.shortIsSmallerHandle;
        handles[2] = p.fillSizeHandle;
        handles[3] = p.longRemainderHandle;
        handles[4] = p.shortRemainderHandle;
    }

    function resolveMatchWithProof(uint256 requestId, bytes calldata cleartexts, bytes calldata decryptionProof)
        external
        onlyGateway
    {
        PendingMatch memory p = pendingMatches[requestId];
        require(p.exists, "invalid request");

        bytes32[] memory handles = new bytes32[](5);
        handles[0] = p.priceMatchedHandle;
        handles[1] = p.shortIsSmallerHandle;
        handles[2] = p.fillSizeHandle;
        handles[3] = p.longRemainderHandle;
        handles[4] = p.shortRemainderHandle;

        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        (bool matched, bool shortIsSmaller, uint64 fillSizeClear, uint64 longRemainderClear, uint64 shortRemainderClear) =
            abi.decode(cleartexts, (bool, bool, uint64, uint64, uint64));

        delete pendingMatches[requestId];

        IPerpOrderBookMatcherSide(orderBook).onResolved(
            requestId,
            matched,
            shortIsSmaller,
            fillSizeClear,
            longRemainderClear,
            shortRemainderClear
        );

        emit MatchResolved(requestId, matched);
    }
}
