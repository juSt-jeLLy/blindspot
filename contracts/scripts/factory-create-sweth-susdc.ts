import { ethers } from 'hardhat';

async function main() {
  const factoryAddr = process.env.MODULAR_DARKPOOL_FACTORY!;
  const sWETH = process.env.SWETH_ADDRESS!;
  const sUSDC = process.env.SUSDC_ADDRESS!;
  const f = await ethers.getContractAt('DarkPoolFactory', factoryAddr);

  try {
    const tx = await f.createPair(sWETH, sUSDC, 'Confidential Shadow WETH', 'csWETH', 'Confidential Shadow USDC', 'csUSDC');
    await tx.wait();
    console.log('createPair tx:', tx.hash);
  } catch (e: any) {
    console.log('createPair note:', e.shortMessage || e.message);
  }

  console.log('pairCount:', (await f.pairCount()).toString());
  const p = await f.getPair(sWETH, sUSDC);
  console.log('sWETH/sUSDC exists:', p.exists);
  console.log('escrow:', p.escrow);
  console.log('matcher:', p.matcher);
  console.log('settlement:', p.settlement);
  console.log('cTokenA:', p.cTokenA);
  console.log('cTokenB:', p.cTokenB);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
