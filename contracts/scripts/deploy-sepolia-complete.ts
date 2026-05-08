import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const gatewayAddress = process.env.GATEWAY_ADDRESS || deployerAddr;

  console.log("Deployer:", deployerAddr);
  console.log("Gateway:", gatewayAddress);

  const Registry = await ethers.getContractFactory("DarkPoolRegistry");
  const registry = await Registry.deploy(deployerAddr);
  await registry.waitForDeployment();
  console.log("DarkPoolRegistry:", await registry.getAddress());

  const Underlying = await ethers.getContractFactory("UnderlyingToken");
  const DarkPoolToken = await ethers.getContractFactory("DarkPoolToken");
  const Settlement = await ethers.getContractFactory("DarkPoolSettlement");
  const Matcher = await ethers.getContractFactory("DarkPoolMatcher");
  const Escrow = await ethers.getContractFactory("DarkPoolEscrow");

  const specs = [
    { name: "Shadow Wrapped ETH", symbol: "sWETH", decimals: 18 },
    { name: "Shadow USD Coin", symbol: "sUSDC", decimals: 6 },
    { name: "Shadow Tether USD", symbol: "sUSDT", decimals: 6 },
    { name: "Shadow Wrapped BTC", symbol: "sWBTC", decimals: 8 },
    { name: "Shadow Arbitrum", symbol: "sARB", decimals: 18 }
  ];

  const underlying: Record<string, string> = {};
  const wrappers: Record<string, string> = {};

  for (const t of specs) {
    const token = await Underlying.deploy(t.name, t.symbol, t.decimals, deployerAddr);
    await token.waitForDeployment();
    const u = await token.getAddress();
    underlying[t.symbol] = u;
    console.log(`${t.symbol}:`, u);

    const c = await DarkPoolToken.deploy(u, `Confidential ${t.name}`, `c${t.symbol}`);
    await c.waitForDeployment();
    const cAddr = await c.getAddress();
    wrappers[t.symbol] = cAddr;
    console.log(`c${t.symbol}:`, cAddr);
  }

  const mintCfg = [
    { sym: "sWETH", amount: ethers.parseUnits("1000", 18) },
    { sym: "sUSDC", amount: ethers.parseUnits("1000000", 6) },
    { sym: "sUSDT", amount: ethers.parseUnits("1000000", 6) },
    { sym: "sWBTC", amount: ethers.parseUnits("1000", 8) },
    { sym: "sARB", amount: ethers.parseUnits("2000000", 18) }
  ];

  for (const m of mintCfg) {
    const token = await ethers.getContractAt("UnderlyingToken", underlying[m.sym]);
    await (await token.mint(deployerAddr, m.amount)).wait();
  }

  const pairDefs = [
    ["sWETH", "sUSDC"],
    ["sWETH", "sUSDT"],
    ["sWBTC", "sUSDC"],
    ["sARB", "sUSDC"],
    ["sWBTC", "sUSDT"]
  ] as const;

  for (const [a, b] of pairDefs) {
    const settlement = await Settlement.deploy(wrappers[a], wrappers[b]);
    await settlement.waitForDeployment();

    const matcher = await Matcher.deploy(await settlement.getAddress(), gatewayAddress);
    await matcher.waitForDeployment();

    const escrow = await Escrow.deploy(wrappers[a], wrappers[b], await matcher.getAddress());
    await escrow.waitForDeployment();

    await (await matcher.setEscrow(await escrow.getAddress())).wait();
    await (await settlement.setMatcher(await matcher.getAddress())).wait();

    await (
      await registry.registerPair({
        tokenA: underlying[a],
        tokenB: underlying[b],
        cTokenA: wrappers[a],
        cTokenB: wrappers[b],
        escrow: await escrow.getAddress(),
        matcher: await matcher.getAddress(),
        settlement: await settlement.getAddress(),
        exists: true
      })
    ).wait();

    console.log(`PAIR ${a}/${b}`);
    console.log("  escrow:", await escrow.getAddress());
    console.log("  matcher:", await matcher.getAddress());
    console.log("  settlement:", await settlement.getAddress());
  }

  console.log("pairCount:", (await registry.pairCount()).toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
