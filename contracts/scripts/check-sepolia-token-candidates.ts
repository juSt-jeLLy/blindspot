import { ethers } from 'hardhat';

const CANDIDATES: Record<string,string> = {
  WETH: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
  USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  LINK: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
  DAI:  '0x68194a729C2450ad26072b3D33ADaCbcef39D574',
  WBTC: '0x29f2D40B0605204364af54EC677bD022dA425d03',
  UNI:  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
};

const ERC20 = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)'
];

async function main() {
  const provider = ethers.provider;
  for (const [k, addr] of Object.entries(CANDIDATES)) {
    try {
      const code = await provider.getCode(addr);
      if (code === '0x') {
        console.log(`${k}: ${addr} -> NO CODE`);
        continue;
      }
      const c = new ethers.Contract(addr, ERC20, provider);
      const [name, symbol, decimals] = await Promise.all([c.name(), c.symbol(), c.decimals()]);
      console.log(`${k}: ${addr} -> ${symbol} (${name}) decimals=${decimals}`);
    } catch (e: any) {
      console.log(`${k}: ${addr} -> ERROR ${e.shortMessage || e.message}`);
    }
  }
}

main().catch((e)=>{ console.error(e); process.exitCode = 1; });
