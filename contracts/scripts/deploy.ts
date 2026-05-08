import { ethers } from "hardhat";

async function main() {
  const owner = process.env.OWNER_ADDRESS;
  const gatewayAddress = process.env.GATEWAY_ADDRESS;

  if (!owner || !gatewayAddress) {
    throw new Error("Set OWNER_ADDRESS and GATEWAY_ADDRESS in env");
  }

  const WrapperDeployer = await ethers.getContractFactory("DarkPoolWrapperDeployer");
  const wrapperDeployer = await WrapperDeployer.deploy(owner);
  await wrapperDeployer.waitForDeployment();

  const PairDeployer = await ethers.getContractFactory("DarkPoolPairDeployer");
  const pairDeployer = await PairDeployer.deploy(owner);
  await pairDeployer.waitForDeployment();

  const Factory = await ethers.getContractFactory("DarkPoolFactory");
  const factory = await Factory.deploy(
    owner,
    gatewayAddress,
    await wrapperDeployer.getAddress(),
    await pairDeployer.getAddress()
  );
  await factory.waitForDeployment();

  await (await wrapperDeployer.transferOwnership(await factory.getAddress())).wait();
  await (await pairDeployer.transferOwnership(await factory.getAddress())).wait();

  console.log("WrapperDeployer:", await wrapperDeployer.getAddress());
  console.log("PairDeployer:", await pairDeployer.getAddress());
  console.log("DarkPoolFactory:", await factory.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
