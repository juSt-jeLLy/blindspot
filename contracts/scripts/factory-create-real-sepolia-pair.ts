import { ethers } from 'hardhat';

async function main() {
  const factoryAddr = process.env.MODULAR_DARKPOOL_FACTORY!;
  const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14';
  const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

  const f = await ethers.getContractAt('DarkPoolFactory', factoryAddr);

  try {
    const tx = await f.createPair(
      WETH_SEPOLIA,
      USDC_SEPOLIA,
      'Confidential WETH',
      'cWETH',
      'Confidential USDC',
      'cUSDC'
    );
    await tx.wait();
    console.log('createPair tx:', tx.hash);
  } catch (e: any) {
    console.log('createPair note:', e.shortMessage || e.message);
  }

  const pair = await f.getPair(WETH_SEPOLIA, USDC_SEPOLIA);
  console.log('exists:', pair.exists);
  console.log('escrow:', pair.escrow);
  console.log('matcher:', pair.matcher);
  console.log('settlement:', pair.settlement);
  console.log('cTokenA:', pair.cTokenA);
  console.log('cTokenB:', pair.cTokenB);
  console.log('pairCount:', (await f.pairCount()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
