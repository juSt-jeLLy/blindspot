import { ethers } from "hardhat";

async function main() {
  const gateway = process.env.GATEWAY_ADDRESS;
  const collateralToken = process.env.PERP_COLLATERAL_TOKEN;
  const symbol = process.env.PERP_SYMBOL || "WETH-PERP";
  const initialPrice = process.env.PERP_INITIAL_PRICE_1E8 || "300000000000"; // 3000 * 1e8

  if (!gateway) throw new Error("GATEWAY_ADDRESS is required");
  if (!collateralToken) throw new Error("PERP_COLLATERAL_TOKEN is required");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  console.log("Gateway:", gateway);
  console.log("Collateral token:", collateralToken);

  const SystemFactory = await ethers.getContractFactory("PerpSystemFactory");
  const systemFactory = await SystemFactory.deploy(await deployer.getAddress(), gateway);
  await systemFactory.waitForDeployment();

  const sfAddr = await systemFactory.getAddress();
  console.log("PerpSystemFactory:", sfAddr);

  const tx = await systemFactory.createSystem(symbol, collateralToken, initialPrice);
  await tx.wait();

  const key = ethers.keccak256(ethers.toUtf8Bytes(symbol));
  const system = await systemFactory.systems(key);
  console.log("System key:", key);
  console.log("PerpMarketFactory:", system.marketFactory);
  console.log("PerpOracle:", system.oracle);
  console.log("PerpPositionManager:", system.positionManager);
  console.log("PerpLiquidationEngine:", system.liquidationEngine);

  const marketFactory = await ethers.getContractAt("PerpMarketFactory", system.marketFactory);
  const mkTx = await marketFactory.createMarket(symbol);
  await mkTx.wait();

  const market = await marketFactory.markets(key);
  console.log("PerpOrderBook:", market.orderBook);
  console.log("PerpMatcher:", market.matcher);
  console.log("PerpClearing:", market.clearing);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
