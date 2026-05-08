import { ethers } from 'hardhat';

type PairInput = {
  key: string;
  a: string;
  b: string;
  nA: string;
  sA: string;
  nB: string;
  sB: string;
};

async function main() {
  const factoryAddr = process.env.MODULAR_DARKPOOL_FACTORY!;
  if (!factoryAddr) throw new Error('Missing MODULAR_DARKPOOL_FACTORY');

  const TOKENS = {
    WETH: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    LINK: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
    DAI:  '0x68194a729C2450ad26072b3D33ADaCbcef39D574',
    WBTC: '0x29f2D40B0605204364af54EC677bD022dA425d03',
    UNI:  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
  };

  const pairs: PairInput[] = [
    { key: 'WETH_LINK', a: TOKENS.WETH, b: TOKENS.LINK, nA: 'Confidential WETH', sA: 'cWETH', nB: 'Confidential LINK', sB: 'cLINK' },
    { key: 'LINK_USDC', a: TOKENS.LINK, b: TOKENS.USDC, nA: 'Confidential LINK', sA: 'cLINK', nB: 'Confidential USDC', sB: 'cUSDC' },
    { key: 'DAI_USDC', a: TOKENS.DAI, b: TOKENS.USDC, nA: 'Confidential DAI', sA: 'cDAI', nB: 'Confidential USDC', sB: 'cUSDC' },
    { key: 'WBTC_USDC', a: TOKENS.WBTC, b: TOKENS.USDC, nA: 'Confidential WBTC', sA: 'cWBTC', nB: 'Confidential USDC', sB: 'cUSDC' },
    { key: 'UNI_WETH', a: TOKENS.UNI, b: TOKENS.WETH, nA: 'Confidential UNI', sA: 'cUNI', nB: 'Confidential WETH', sB: 'cWETH' }
  ];

  const f = await ethers.getContractAt('DarkPoolFactory', factoryAddr);

  for (const p of pairs) {
    try {
      const tx = await f.createPair(p.a, p.b, p.nA, p.sA, p.nB, p.sB);
      await tx.wait();
      console.log(`[${p.key}] createPair tx: ${tx.hash}`);
    } catch (e: any) {
      console.log(`[${p.key}] createPair note: ${e.shortMessage || e.message}`);
    }

    const pair = await f.getPair(p.a, p.b);
    console.log(`[${p.key}] exists=${pair.exists} escrow=${pair.escrow} matcher=${pair.matcher} settlement=${pair.settlement} cTokenA=${pair.cTokenA} cTokenB=${pair.cTokenB}`);
  }

  console.log('pairCount:', (await f.pairCount()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
