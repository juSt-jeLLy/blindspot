import { ethers } from "hardhat";

type PairSpec = {
  key: string;
  cTokenA: string;
  cTokenB: string;
};

async function main() {
  const gateway = process.env.GATEWAY_ADDRESS;
  if (!gateway) throw new Error("Missing GATEWAY_ADDRESS");

  const pairs: PairSpec[] = [
    {
      key: "WETH_USDC",
      cTokenA: "0x1D9489bFfBfD3bF60535e19282362E8C93dfaec6",
      cTokenB: "0xe07D85837E18025B07052b7A8568bAe01837CfD9",
    },
    {
      key: "WETH_LINK",
      cTokenA: "0x1D9489bFfBfD3bF60535e19282362E8C93dfaec6",
      cTokenB: "0xaC2603C4765d2F5b636dEa9DA95f525f6078bBB6",
    },
    {
      key: "LINK_USDC",
      cTokenA: "0xaC2603C4765d2F5b636dEa9DA95f525f6078bBB6",
      cTokenB: "0xe07D85837E18025B07052b7A8568bAe01837CfD9",
    },
    {
      key: "DAI_USDC",
      cTokenA: "0xc7D2D454D2588732065A0f46dc6821E73942F132",
      cTokenB: "0xe07D85837E18025B07052b7A8568bAe01837CfD9",
    },
    {
      key: "WBTC_USDC",
      cTokenA: "0xF8901B37b242Ef58afa2de38CCB68F50D7DE668F",
      cTokenB: "0xe07D85837E18025B07052b7A8568bAe01837CfD9",
    },
    {
      key: "UNI_WETH",
      cTokenA: "0x89E3B11D38a519c8A00A1FeDf298EB8933aAbB06",
      cTokenB: "0x1D9489bFfBfD3bF60535e19282362E8C93dfaec6",
    },
  ];

  const Settlement = await ethers.getContractFactory("DarkPoolSettlement");
  const Matcher = await ethers.getContractFactory("DarkPoolMatcher");
  const Escrow = await ethers.getContractFactory("DarkPoolEscrow");

  for (const p of pairs) {
    const settlement = await Settlement.deploy(p.cTokenA, p.cTokenB);
    await settlement.waitForDeployment();

    const matcher = await Matcher.deploy(await settlement.getAddress(), gateway);
    await matcher.waitForDeployment();

    const escrow = await Escrow.deploy(p.cTokenA, p.cTokenB, await matcher.getAddress());
    await escrow.waitForDeployment();

    await (await matcher.setEscrow(await escrow.getAddress())).wait();
    await (await settlement.setMatcher(await matcher.getAddress())).wait();

    console.log(`${p.key}_ESCROW=${await escrow.getAddress()}`);
    console.log(`${p.key}_MATCHER=${await matcher.getAddress()}`);
    console.log(`${p.key}_SETTLEMENT=${await settlement.getAddress()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

