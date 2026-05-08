// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { DarkPoolToken } from "./DarkPoolToken.sol";
import { DarkPoolEscrow } from "./DarkPoolEscrow.sol";
import { DarkPoolMatcher } from "./DarkPoolMatcher.sol";
import { DarkPoolSettlement } from "./DarkPoolSettlement.sol";

contract DarkPoolFactory {
    address public owner;
    address public gateway;
    struct Pair {
        address tokenA;
        address tokenB;
        address cTokenA;
        address cTokenB;
        address escrow;
        address matcher;
        address settlement;
        bool exists;
    }

    mapping(bytes32 => Pair) public pairs;
    mapping(address => address) public wrapperOf;
    bytes32[] public allPairHashes;

    event PairCreated(
        address indexed tokenA,
        address indexed tokenB,
        address cTokenA,
        address cTokenB,
        address escrow,
        address matcher,
        address settlement,
        bytes32 pairHash
    );

    event WrapperDeployed(address indexed underlying, address indexed wrapper);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address gatewayAddress) {
        require(gatewayAddress != address(0), "zero gateway");
        owner = msg.sender;
        gateway = gatewayAddress;
    }

    function setGateway(address gatewayAddress) external onlyOwner {
        require(gatewayAddress != address(0), "zero gateway");
        gateway = gatewayAddress;
    }

    function createPair(
        address tokenA,
        address tokenB,
        string calldata nameA,
        string calldata symbolA,
        string calldata nameB,
        string calldata symbolB
    ) external returns (address escrowAddress) {
        require(tokenA != address(0) && tokenB != address(0) && tokenA != tokenB, "invalid pair");

        address t0;
        address t1;
        string memory wrapName0;
        string memory wrapSymbol0;
        string memory wrapName1;
        string memory wrapSymbol1;
        if (tokenA < tokenB) {
            t0 = tokenA;
            t1 = tokenB;
            wrapName0 = nameA;
            wrapSymbol0 = symbolA;
            wrapName1 = nameB;
            wrapSymbol1 = symbolB;
        } else {
            t0 = tokenB;
            t1 = tokenA;
            wrapName0 = nameB;
            wrapSymbol0 = symbolB;
            wrapName1 = nameA;
            wrapSymbol1 = symbolA;
        }

        bytes32 pairHash = keccak256(abi.encodePacked(t0, t1));
        require(!pairs[pairHash].exists, "pair exists");

        address cT0 = _getOrDeployWrapper(t0, wrapName0, wrapSymbol0);
        address cT1 = _getOrDeployWrapper(t1, wrapName1, wrapSymbol1);

        DarkPoolSettlement settlement = new DarkPoolSettlement(cT0, cT1);
        DarkPoolMatcher matcher = new DarkPoolMatcher(address(settlement), gateway, false);
        DarkPoolEscrow escrow = new DarkPoolEscrow(cT0, cT1, address(matcher), false);

        matcher.setEscrow(address(escrow));
        settlement.setMatcher(address(matcher));

        pairs[pairHash] = Pair({
            tokenA: t0,
            tokenB: t1,
            cTokenA: cT0,
            cTokenB: cT1,
            escrow: address(escrow),
            matcher: address(matcher),
            settlement: address(settlement),
            exists: true
        });
        allPairHashes.push(pairHash);

        emit PairCreated(t0, t1, cT0, cT1, address(escrow), address(matcher), address(settlement), pairHash);
        return address(escrow);
    }

    function pairCount() external view returns (uint256) {
        return allPairHashes.length;
    }

    function getPair(address tokenA, address tokenB) external view returns (Pair memory) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return pairs[keccak256(abi.encodePacked(t0, t1))];
    }

    function _getOrDeployWrapper(address underlying, string memory name, string memory symbol) internal returns (address) {
        address existing = wrapperOf[underlying];
        if (existing != address(0)) {
            return existing;
        }

        DarkPoolToken wrapper = new DarkPoolToken(underlying, name, symbol);
        wrapperOf[underlying] = address(wrapper);
        emit WrapperDeployed(underlying, address(wrapper));
        return address(wrapper);
    }
}
