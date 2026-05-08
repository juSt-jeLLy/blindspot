import { ethers } from 'hardhat';

async function main() {
  const factoryAddr = process.env.MODULAR_DARKPOOL_FACTORY || '0xD1b8BD379586f385E8c10432372Ea6B7f9736C48';
  const factory = await ethers.getContractAt('DarkPoolFactory', factoryAddr);

  const pairs = [
    {
      a: process.env.SWETH_ADDRESS!,
      b: process.env.SUSDT_ADDRESS!,
      nA: 'Confidential Shadow WETH', sA: 'csWETH',
      nB: 'Confidential Shadow USDT', sB: 'csUSDT'
    },
    {
      a: process.env.SWBTC_ADDRESS!,
      b: process.env.SUSDC_ADDRESS!,
      nA: 'Confidential Shadow WBTC', sA: 'csWBTC',
      nB: 'Confidential Shadow USDC', sB: 'csUSDC'
    },
    {
      a: process.env.SARB_ADDRESS!,
      b: process.env.SUSDC_ADDRESS!,
      nA: 'Confidential Shadow ARB', sA: 'csARB',
      nB: 'Confidential Shadow USDC', sB: 'csUSDC'
    }
  ];

  for (const p of pairs) {
    try {
      const tx = await factory.createPair(p.a, p.b, p.nA, p.sA, p.nB, p.sB);
      await tx.wait();
      console.log('createPair tx:', tx.hash);
    } catch (e: any) {
      console.log('createPair note:', e.shortMessage || e.message);
    }
  }

  const count = await factory.pairCount();
  console.log('pairCount:', count.toString());

  for (const p of pairs) {
    const pair = await factory.getPair(p.a, p.b);
    console.log('PAIR', p.a, p.b);
    console.log(' exists:', pair.exists);
    console.log(' escrow:', pair.escrow);
    console.log(' matcher:', pair.matcher);
    console.log(' settlement:', pair.settlement);
    console.log(' cTokenA:', pair.cTokenA);
    console.log(' cTokenB:', pair.cTokenB);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
