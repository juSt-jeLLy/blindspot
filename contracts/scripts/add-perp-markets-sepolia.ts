import { ethers } from "hardhat";

async function ensureMarket(routerAddr: string, symbol: string, collateralToken: string, initialPrice1e8: bigint) {
  const router = await ethers.getContractAt("PerpFactoryRouter", routerAddr);
  const key = ethers.keccak256(ethers.toUtf8Bytes(symbol));
  const current = await router.getSystem(key);
  if (current.exists) {
    console.log(symbol, "already exists", key);
    return { key, system: current };
  }
  const tx = await router.initializeSystem(symbol, collateralToken, initialPrice1e8);
  await tx.wait();
  const system = await router.getSystem(key);
  console.log(symbol, "created", key);
  return { key, system };
}

async function main() {
  const routerAddr = process.env.PERP_ROUTER_ADDRESS;
  const collateral = process.env.PERP_COLLATERAL_TOKEN;
  if (!routerAddr) throw new Error("PERP_ROUTER_ADDRESS required");
  if (!collateral) throw new Error("PERP_COLLATERAL_TOKEN required");

  const [deployer] = await ethers.getSigners();
  console.log("deployer", await deployer.getAddress());

  const markets = [
    { symbol: "WETH-PERP", px: 3000n * 10n ** 8n },
    { symbol: "WBTC-PERP", px: 65000n * 10n ** 8n },
    { symbol: "LINK-PERP", px: 15n * 10n ** 8n },
  ];

  const out: Record<string, any> = {};
  for (const m of markets) {
    const r = await ensureMarket(routerAddr, m.symbol, collateral, m.px);
    out[m.symbol] = {
      key: r.key,
      oracle: r.system.oracle,
      positionManager: r.system.positionManager,
      liquidationEngine: r.system.liquidationEngine,
      orderBook: r.system.orderBook,
      matcher: r.system.matcher,
      clearing: r.system.clearing,
      collateralToken: r.system.collateralToken,
      exists: r.system.exists,
    };
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
