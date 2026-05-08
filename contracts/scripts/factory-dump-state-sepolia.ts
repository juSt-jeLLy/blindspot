import { ethers } from 'hardhat';

async function main() {
  const f = await ethers.getContractAt('DarkPoolFactory', '0xD1b8BD379586f385E8c10432372Ea6B7f9736C48');

  const addrs = {
    sWETH: process.env.SWETH_ADDRESS!,
    sUSDC: process.env.SUSDC_ADDRESS!,
    sUSDT: process.env.SUSDT_ADDRESS!,
    sWBTC: process.env.SWBTC_ADDRESS!,
    sARB: process.env.SARB_ADDRESS!
  };

  console.log('pairCount', (await f.pairCount()).toString());
  for (const [k, v] of Object.entries(addrs)) {
    console.log('wrapperOf', k, await f.wrapperOf(v));
  }

  const keys: Array<[string, string, string]> = [
    ['sWETH_sUSDC', addrs.sWETH, addrs.sUSDC],
    ['sWETH_sUSDT', addrs.sWETH, addrs.sUSDT],
    ['sWBTC_sUSDC', addrs.sWBTC, addrs.sUSDC],
    ['sARB_sUSDC', addrs.sARB, addrs.sUSDC]
  ];

  for (const [name, a, b] of keys) {
    const p = await f.getPair(a, b);
    console.log(name, JSON.stringify({
      exists: p.exists,
      escrow: p.escrow,
      matcher: p.matcher,
      settlement: p.settlement,
      cTokenA: p.cTokenA,
      cTokenB: p.cTokenB
    }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
