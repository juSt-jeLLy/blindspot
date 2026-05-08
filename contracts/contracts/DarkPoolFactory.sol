// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { DarkPoolWrapperDeployer } from "./DarkPoolWrapperDeployer.sol";
import { DarkPoolPairDeployer } from "./DarkPoolPairDeployer.sol";

contract DarkPoolFactory is Ownable {
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

    address public gateway;
    DarkPoolWrapperDeployer public immutable wrapperDeployer;
    DarkPoolPairDeployer public immutable pairDeployer;

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

    constructor(address owner_, address gatewayAddress, address wrapperDeployer_, address pairDeployer_) Ownable(owner_) {
        require(gatewayAddress != address(0), "zero gateway");
        require(wrapperDeployer_ != address(0) && pairDeployer_ != address(0), "zero deployer");
        gateway = gatewayAddress;
        wrapperDeployer = DarkPoolWrapperDeployer(wrapperDeployer_);
        pairDeployer = DarkPoolPairDeployer(pairDeployer_);
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
    ) external onlyOwner returns (address escrowAddress) {
        require(tokenA != address(0) && tokenB != address(0) && tokenA != tokenB, "invalid pair");

        (address t0, address t1, string memory n0, string memory s0, string memory n1, string memory s1) = tokenA < tokenB
            ? (tokenA, tokenB, nameA, symbolA, nameB, symbolB)
            : (tokenB, tokenA, nameB, symbolB, nameA, symbolA);

        bytes32 pairHash = keccak256(abi.encodePacked(t0, t1));
        require(!pairs[pairHash].exists, "pair exists");

        address cT0 = _getOrDeployWrapper(t0, n0, s0);
        address cT1 = _getOrDeployWrapper(t1, n1, s1);

        (address escrow, address matcher, address settlement) = pairDeployer.deployPair(cT0, cT1, gateway);

        pairs[pairHash] = Pair({
            tokenA: t0,
            tokenB: t1,
            cTokenA: cT0,
            cTokenB: cT1,
            escrow: escrow,
            matcher: matcher,
            settlement: settlement,
            exists: true
        });
        allPairHashes.push(pairHash);

        emit PairCreated(t0, t1, cT0, cT1, escrow, matcher, settlement, pairHash);
        return escrow;
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
        if (existing != address(0)) return existing;

        address wrapper = wrapperDeployer.deployWrapper(underlying, name, symbol);
        wrapperOf[underlying] = wrapper;
        emit WrapperDeployed(underlying, wrapper);
        return wrapper;
    }
}
