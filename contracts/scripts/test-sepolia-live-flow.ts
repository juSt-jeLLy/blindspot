import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();

  const factoryAddr = process.env.MODULAR_DARKPOOL_FACTORY!;
  const sWeth = process.env.SWETH_ADDRESS!;
  const sUsdc = process.env.SUSDC_ADDRESS!;

  if (!factoryAddr || !sWeth || !sUsdc) {
    throw new Error("Missing MODULAR_DARKPOOL_FACTORY/SWETH_ADDRESS/SUSDC_ADDRESS");
  }

  const factory = await ethers.getContractAt("DarkPoolFactory", factoryAddr);
  const pairCount = await factory.pairCount();
  console.log("pairCount:", pairCount.toString());

  const pair = await factory.getPair(sWeth, sUsdc);
  if (!pair.exists) throw new Error("sWETH/sUSDC pair not found on new factory");
  console.log("pair.exists:", pair.exists);
  console.log("pair.escrow:", pair.escrow);

  const weth = await ethers.getContractAt("UnderlyingToken", sWeth);
  const usdc = await ethers.getContractAt("UnderlyingToken", sUsdc);
  const cweth = await ethers.getContractAt("DarkPoolToken", pair.cTokenA);
  const cusdc = await ethers.getContractAt("DarkPoolToken", pair.cTokenB);

  const mintWeth = ethers.parseUnits("5", 18);
  const mintUsdc = ethers.parseUnits("50000", 6);
  await (await weth.mint(me, mintWeth)).wait();
  await (await usdc.mint(me, mintUsdc)).wait();

  await (await weth.approve(await cweth.getAddress(), mintWeth)).wait();
  await (await usdc.approve(await cusdc.getAddress(), mintUsdc)).wait();

  const wrapWeth = ethers.parseUnits("1", 18);
  const wrapUsdc = ethers.parseUnits("10000", 6);
  await (await cweth.wrap(me, wrapWeth)).wait();
  await (await cusdc.wrap(me, wrapUsdc)).wait();
  console.log("wrapped balances minted for deployer");

  const until = BigInt(Math.floor(Date.now() / 1000) + 3600 * 24 * 7);
  await (await cweth.setOperator(pair.escrow, until)).wait();
  await (await cusdc.setOperator(pair.escrow, until)).wait();
  console.log("escrow operator permissions set");

  const escrow = await ethers.getContractAt("DarkPoolEscrow", pair.escrow);
  try {
    await escrow.submitSellOrder.staticCall(
      "0x" + "00".repeat(32),
      "0x",
      "0x" + "00".repeat(32),
      "0x"
    );
    console.log("unexpected: static submitSellOrder did not revert");
  } catch (err: any) {
    console.log("submitSellOrder preflight revert (expected without valid relayer ciphertext/proof):", err?.shortMessage || err?.message);
  }

  console.log("new-factory live flow preflight complete");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
