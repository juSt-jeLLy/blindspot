import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  const Engine = await ethers.getContractFactory("PerpTradingEngine");
  const engine = await Engine.deploy();
  await engine.waitForDeployment();
  console.log("PerpTradingEngine:", await engine.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
