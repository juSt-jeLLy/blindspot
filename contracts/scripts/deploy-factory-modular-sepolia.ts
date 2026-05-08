import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = await deployer.getAddress();
  const gateway = process.env.GATEWAY_ADDRESS || owner;

  const WrapperDeployer = await ethers.getContractFactory("DarkPoolWrapperDeployer");
  const wrapperDeployer = await WrapperDeployer.deploy(owner);
  await wrapperDeployer.waitForDeployment();

  const PairDeployer = await ethers.getContractFactory("DarkPoolPairDeployer");
  const pairDeployer = await PairDeployer.deploy(owner);
  await pairDeployer.waitForDeployment();

  const Factory = await ethers.getContractFactory("DarkPoolFactory");
  const factory = await Factory.deploy(owner, gateway, await wrapperDeployer.getAddress(), await pairDeployer.getAddress());
  await factory.waitForDeployment();

  console.log("WrapperDeployer:", await wrapperDeployer.getAddress());
  console.log("PairDeployer:", await pairDeployer.getAddress());
  console.log("DarkPoolFactory:", await factory.getAddress());

  // Transfer deployer ownership to factory so factory can call deploy methods.
  await (await wrapperDeployer.transferOwnership(await factory.getAddress())).wait();
  await (await pairDeployer.transferOwnership(await factory.getAddress())).wait();
  console.log("Ownership of deployers transferred to factory.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
