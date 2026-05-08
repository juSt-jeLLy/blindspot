import { ethers } from 'hardhat';

async function main() {
  const factoryAddr = '0xD1b8BD379586f385E8c10432372Ea6B7f9736C48';
  const sWETH = process.env.SWETH_ADDRESS!;
  const sUSDC = process.env.SUSDC_ADDRESS!;

  const factory = await ethers.getContractAt('DarkPoolFactory', factoryAddr);
  try {
    const tx = await factory.createPair(
      sWETH,
      sUSDC,
      'Confidential Shadow WETH',
      'csWETH2',
      'Confidential Shadow USDC',
      'csUSDC2'
    );
    await tx.wait();
    console.log('createPair tx:', tx.hash);
  } catch (e: any) {
    console.log('createPair note:', e.shortMessage || e.message);
  }

  const count = await factory.pairCount();
  const pair = await factory.getPair(sWETH, sUSDC);
  console.log('pairCount:', count.toString());
  console.log('pair.exists:', pair.exists);
  console.log('pair.escrow:', pair.escrow);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
