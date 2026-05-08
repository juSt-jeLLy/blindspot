import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();

  const registryAddr = process.env.REGISTRY_ADDRESS!;
  const sWeth = process.env.SWETH_ADDRESS!;
  const sUsdc = process.env.SUSDC_ADDRESS!;
  const csWeth = process.env.CSWETH_ADDRESS!;
  const csUsdc = process.env.CSUSDC_ADDRESS!;
  const escrowAddr = process.env.PAIR_SWETH_SUSDC_ESCROW!;

  if (!registryAddr || !sWeth || !sUsdc || !csWeth || !csUsdc || !escrowAddr) {
    throw new Error("Missing required env vars for live flow test");
  }

  const registry = await ethers.getContractAt("DarkPoolRegistry", registryAddr);
  const pairCount = await registry.pairCount();
  console.log("pairCount:", pairCount.toString());

  const pair = await registry.getPair(sWeth, sUsdc);
  console.log("pair.exists:", pair.exists);
  console.log("pair.escrow:", pair.escrow);

  const weth = await ethers.getContractAt("UnderlyingToken", sWeth);
  const usdc = await ethers.getContractAt("UnderlyingToken", sUsdc);
  const cweth = await ethers.getContractAt("DarkPoolToken", csWeth);
  const cusdc = await ethers.getContractAt("DarkPoolToken", csUsdc);

  // Ensure deployer has underlying balances.
  const mintWeth = ethers.parseUnits("10", 18);
  const mintUsdc = ethers.parseUnits("100000", 6);
  await (await weth.mint(me, mintWeth)).wait();
  await (await usdc.mint(me, mintUsdc)).wait();

  // Approve wrapper contracts to take underlying.
  await (await weth.approve(csWeth, mintWeth)).wait();
  await (await usdc.approve(csUsdc, mintUsdc)).wait();

  // Wrap some balances into confidential wrappers.
  const wrapWeth = ethers.parseUnits("2", 18);
  const wrapUsdc = ethers.parseUnits("20000", 6);
  await (await cweth.wrap(me, wrapWeth)).wait();
  await (await cusdc.wrap(me, wrapUsdc)).wait();
  console.log("wrapped csWETH/csUSDC balances for deployer");

  // Grant escrow operator rights for confidential transferFrom usage.
  const until = BigInt(Math.floor(Date.now() / 1000) + 3600 * 24 * 7);
  await (await cweth.setOperator(escrowAddr, until)).wait();
  await (await cusdc.setOperator(escrowAddr, until)).wait();
  console.log("operator approvals set for escrow");

  // Attempt production submit path with placeholder ciphertext/proof.
  // This should revert unless valid relayer-generated ciphertext+proof is supplied.
  const escrow = await ethers.getContractAt("DarkPoolEscrow", escrowAddr);
  try {
    await escrow.submitSellOrder.staticCall(
      "0x" + "00".repeat(32),
      "0x",
      "0x" + "00".repeat(32),
      "0x"
    );
    console.log("unexpected: static submitSellOrder did not revert");
  } catch (err: any) {
    console.log("submitSellOrder preflight revert (expected without relayer proof):", err?.shortMessage || err?.message);
  }

  console.log("live flow preflight complete");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
