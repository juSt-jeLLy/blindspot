import { ethers } from "hardhat";

async function main() {
  const gateway = process.env.GATEWAY_ADDRESS;
  if (!gateway) throw new Error("GATEWAY_ADDRESS is required");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  console.log("Gateway:", gateway);

  const Factory = await ethers.getContractFactory("PerpMarketFactory");
  const factory = await Factory.deploy(await deployer.getAddress(), gateway);
  await factory.waitForDeployment();

  const factoryAddr = await factory.getAddress();
  console.log("PerpMarketFactory:", factoryAddr);

  const tx = await factory.createMarket("WETH-PERP");
  await tx.wait();
  const key = ethers.keccak256(ethers.toUtf8Bytes("WETH-PERP"));
  const market = await factory.markets(key);

  console.log("Market key:", key);
  console.log("OrderBook:", market.orderBook);
  console.log("Matcher:", market.matcher);
  console.log("Clearing:", market.clearing);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
