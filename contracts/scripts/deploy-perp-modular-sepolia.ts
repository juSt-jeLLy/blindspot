import { ethers } from "hardhat";

async function main() {
  const gateway = process.env.GATEWAY_ADDRESS;
  const collateralToken = process.env.PERP_COLLATERAL_TOKEN;
  const symbol = process.env.PERP_SYMBOL || "WETH-PERP";
  const initialPrice = process.env.PERP_INITIAL_PRICE_1E8 || "300000000000";

  if (!gateway) throw new Error("GATEWAY_ADDRESS is required");
  if (!collateralToken) throw new Error("PERP_COLLATERAL_TOKEN is required");

  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  console.log("Deployer:", deployerAddr);
  console.log("Gateway:", gateway);

  const Router = await ethers.getContractFactory("PerpFactoryRouter");
  const router = await Router.deploy(deployerAddr);
  await router.waitForDeployment();

  const CoreFactory = await ethers.getContractFactory("PerpCoreFactory");
  const coreFactory = await CoreFactory.deploy(await router.getAddress(), gateway);
  await coreFactory.waitForDeployment();

  const MarketFactory = await ethers.getContractFactory("PerpMarketFactory");
  const marketFactory = await MarketFactory.deploy(await router.getAddress(), gateway);
  await marketFactory.waitForDeployment();

  await (await router.setFactories(await coreFactory.getAddress(), await marketFactory.getAddress())).wait();

  await (await router.initializeSystem(symbol, collateralToken, initialPrice)).wait();
  const key = ethers.keccak256(ethers.toUtf8Bytes(symbol));
  const system = await router.getSystem(key);

  const out = {
    symbol,
    key,
    coreFactory: await coreFactory.getAddress(),
    marketFactory: await marketFactory.getAddress(),
    router: await router.getAddress(),
    oracle: system.oracle,
    positionManager: system.positionManager,
    liquidationEngine: system.liquidationEngine,
    orderBook: system.orderBook,
    matcher: system.matcher,
    clearing: system.clearing,
    collateralToken: system.collateralToken,
    exists: system.exists,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
