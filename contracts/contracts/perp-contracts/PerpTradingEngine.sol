// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PerpTradingEngine is ZamaEthereumConfig {
    function computeExposure(euint64 size, euint64 leverageE6) external returns (euint64) {
        // Exposure ~= size * leverage (scaled by 1e6)
        return FHE.div(FHE.mul(size, leverageE6), 1_000_000);
    }

    function computePnlAbs(
        bool isLong,
        uint256 entryPrice1e8,
        uint256 currentPrice1e8,
        euint64 size
    ) external returns (euint64) {
        uint256 delta = isLong
            ? (currentPrice1e8 > entryPrice1e8 ? currentPrice1e8 - entryPrice1e8 : entryPrice1e8 - currentPrice1e8)
            : (entryPrice1e8 > currentPrice1e8 ? entryPrice1e8 - currentPrice1e8 : currentPrice1e8 - entryPrice1e8);

        return FHE.mul(size, FHE.asEuint64(uint64(delta)));
    }
}
