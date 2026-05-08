// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract DarkPoolRegistry is Ownable {
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
    bytes32[] public allPairHashes;

    event PairRegistered(bytes32 indexed pairHash, address tokenA, address tokenB, address escrow);

    constructor(address owner_) Ownable(owner_) {}

    function registerPair(Pair calldata p) external onlyOwner {
        require(p.tokenA != address(0) && p.tokenB != address(0), "zero token");
        bytes32 pairHash = _pairHash(p.tokenA, p.tokenB);
        require(!pairs[pairHash].exists, "pair exists");
        pairs[pairHash] = Pair({
            tokenA: p.tokenA,
            tokenB: p.tokenB,
            cTokenA: p.cTokenA,
            cTokenB: p.cTokenB,
            escrow: p.escrow,
            matcher: p.matcher,
            settlement: p.settlement,
            exists: true
        });
        allPairHashes.push(pairHash);
        emit PairRegistered(pairHash, p.tokenA, p.tokenB, p.escrow);
    }

    function getPair(address tokenA, address tokenB) external view returns (Pair memory) {
        return pairs[_pairHash(tokenA, tokenB)];
    }

    function pairCount() external view returns (uint256) {
        return allPairHashes.length;
    }

    function _pairHash(address tokenA, address tokenB) internal pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }
}
