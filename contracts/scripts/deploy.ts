import { ethers } from "hardhat";

async function main() {
  const gatewayAddress = process.env.GATEWAY_ADDRESS;
  const tokenA = process.env.TOKEN_A;
  const tokenB = process.env.TOKEN_B;
  const nameA = process.env.CTOKEN_A_NAME ?? "Confidential Token A";
  const symbolA = process.env.CTOKEN_A_SYMBOL ?? "cTKNA";
  const nameB = process.env.CTOKEN_B_NAME ?? "Confidential Token B";
  const symbolB = process.env.CTOKEN_B_SYMBOL ?? "cTKNB";

  if (!gatewayAddress || !tokenA || !tokenB) {
    throw new Error("Set GATEWAY_ADDRESS, TOKEN_A, TOKEN_B in env");
  }

  const Factory = await ethers.getContractFactory("DarkPoolFactory");
  const factory = await Factory.deploy(gatewayAddress);
  await factory.waitForDeployment();

  console.log("DarkPoolFactory:", await factory.getAddress());

  const tx = await factory.createPair(tokenA, tokenB, nameA, symbolA, nameB, symbolB);
  await tx.wait();

  const pair = await factory.getPair(tokenA, tokenB);
  console.log("Pair escrow:", pair.escrow);
  console.log("Pair matcher:", pair.matcher);
  console.log("Pair settlement:", pair.settlement);
  console.log("Pair cTokenA:", pair.cTokenA);
  console.log("Pair cTokenB:", pair.cTokenB);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
