import { ethers } from "hardhat";

async function main() {
  const gateway = process.env.GATEWAY_ADDRESS;
  if (!gateway) throw new Error("Missing GATEWAY_ADDRESS");

  const cWETH = "0x1D9489bFfBfD3bF60535e19282362E8C93dfaec6";
  const cUSDC = "0xe07D85837E18025B07052b7A8568bAe01837CfD9";

  const Settlement = await ethers.getContractFactory("DarkPoolSettlement");
  const settlement = await Settlement.deploy(cWETH, cUSDC);
  await settlement.waitForDeployment();

  const Matcher = await ethers.getContractFactory("DarkPoolMatcher");
  const matcher = await Matcher.deploy(await settlement.getAddress(), gateway);
  await matcher.waitForDeployment();

  const Escrow = await ethers.getContractFactory("DarkPoolEscrow");
  const escrow = await Escrow.deploy(cWETH, cUSDC, await matcher.getAddress());
  await escrow.waitForDeployment();

  await (await matcher.setEscrow(await escrow.getAddress())).wait();
  await (await settlement.setMatcher(await matcher.getAddress())).wait();

  console.log("FIXED_WETH_USDC_ESCROW=", await escrow.getAddress());
  console.log("FIXED_WETH_USDC_MATCHER=", await matcher.getAddress());
  console.log("FIXED_WETH_USDC_SETTLEMENT=", await settlement.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

