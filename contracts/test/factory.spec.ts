import { expect } from "chai";
import { ethers } from "hardhat";

describe("DarkPoolFactory", function () {
  it("creates and registers a pair", async function () {
    const [deployer, gateway] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const weth = await Token.deploy("Wrapped ETH", "WETH", 18);
    const usdt = await Token.deploy("Tether USD", "USDT", 6);

    const Factory = await ethers.getContractFactory("DarkPoolFactory");
    const factory = await Factory.deploy(await gateway.getAddress());

    const tx = await factory.createPair(
      await weth.getAddress(),
      await usdt.getAddress(),
      "Confidential WETH",
      "cWETH",
      "Confidential USDT",
      "cUSDT"
    );
    await tx.wait();

    const pair = await factory.getPair(await weth.getAddress(), await usdt.getAddress());

    expect(pair.exists).to.eq(true);
    expect(pair.escrow).to.not.eq(ethers.ZeroAddress);
    expect(pair.matcher).to.not.eq(ethers.ZeroAddress);
    expect(pair.settlement).to.not.eq(ethers.ZeroAddress);

    expect(await factory.pairCount()).to.eq(1n);

    const cWeth = await factory.wrapperOf(await weth.getAddress());
    const cUsdt = await factory.wrapperOf(await usdt.getAddress());

    expect(cWeth).to.not.eq(ethers.ZeroAddress);
    expect(cUsdt).to.not.eq(ethers.ZeroAddress);
    expect(pair.cTokenA === cWeth || pair.cTokenB === cWeth).to.eq(true);
    expect(pair.cTokenA === cUsdt || pair.cTokenB === cUsdt).to.eq(true);

    expect(await deployer.getAddress()).to.be.a("string");
  });
});
