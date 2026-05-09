import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

describe("Perp integration: encrypted submit -> proof-verified resolve", function () {
  async function deployFixture() {
    const [owner, longTrader, shortTrader, gateway, intruder] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("PerpMarketFactory");
    const factory = await Factory.deploy(await owner.getAddress(), await gateway.getAddress());

    await (await factory.createMarket("WETH-PERP")).wait();
    const key = ethers.keccak256(ethers.toUtf8Bytes("WETH-PERP"));
    const market = await factory.markets(key);

    const orderBook = await ethers.getContractAt("PerpOrderBook", market.orderBook);
    const matcher = await ethers.getContractAt("PerpMatcher", market.matcher);
    const clearing = await ethers.getContractAt("PerpClearing", market.clearing);

    return { longTrader, shortTrader, gateway, intruder, orderBook, matcher, clearing };
  }

  async function submitEncryptedLong(orderBook: any, trader: any, price: number, size: number) {
    const input = fhevm.createEncryptedInput(await orderBook.getAddress(), await trader.getAddress());
    input.add64(price);
    input.add64(size);
    const enc = await input.encrypt();

    await orderBook.connect(trader).submitLongOrder(enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof);
  }

  async function submitEncryptedShort(orderBook: any, trader: any, price: number, size: number) {
    const input = fhevm.createEncryptedInput(await orderBook.getAddress(), await trader.getAddress());
    input.add64(price);
    input.add64(size);
    const enc = await input.encrypt();

    await orderBook.connect(trader).submitShortOrder(enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof);
  }

  async function resolveWithProof(matcher: any, gateway: any, requestId: number) {
    const handles = await matcher.getPendingHandles(requestId);
    const decryptRes = await fhevm.publicDecrypt(handles);
    await matcher.connect(gateway).resolveMatchWithProof(requestId, decryptRes.abiEncodedClearValues, decryptRes.decryptionProof);
  }

  it("full fill: marks both orders filled and updates positions", async function () {
    const { longTrader, shortTrader, gateway, orderBook, matcher, clearing } = await deployFixture();

    await submitEncryptedLong(orderBook, longTrader, 3000, 10);
    await submitEncryptedShort(orderBook, shortTrader, 3000, 10);

    await resolveWithProof(matcher, gateway, 1);

    const longOrder = await orderBook.orders(1);
    const shortOrder = await orderBook.orders(2);

    expect(longOrder.status).to.equal(3n);
    expect(shortOrder.status).to.equal(3n);

    const [longHandle] = await clearing.getPositionHandles(await longTrader.getAddress());
    const [, shortHandle] = await clearing.getPositionHandles(await shortTrader.getAddress());
    expect(longHandle).to.not.equal(ethers.ZeroHash);
    expect(shortHandle).to.not.equal(ethers.ZeroHash);
  });

  it("partial fill: requeues long remainder", async function () {
    const { longTrader, shortTrader, gateway, orderBook, matcher } = await deployFixture();

    await submitEncryptedLong(orderBook, longTrader, 3000, 10);
    await submitEncryptedShort(orderBook, shortTrader, 2900, 6);

    await resolveWithProof(matcher, gateway, 1);

    const oldLong = await orderBook.orders(1);
    const shortOrder = await orderBook.orders(2);
    const newLong = await orderBook.orders(3);

    expect(oldLong.status).to.equal(2n);
    expect(shortOrder.status).to.equal(3n);
    expect(newLong.status).to.equal(1n);
  });

  it("no match: leaves orders open", async function () {
    const { longTrader, shortTrader, gateway, orderBook, matcher } = await deployFixture();

    await submitEncryptedLong(orderBook, longTrader, 2800, 10);
    await submitEncryptedShort(orderBook, shortTrader, 3000, 10);

    await resolveWithProof(matcher, gateway, 1);

    const longOrder = await orderBook.orders(1);
    const shortOrder = await orderBook.orders(2);

    expect(longOrder.status).to.equal(1n);
    expect(shortOrder.status).to.equal(1n);
  });

  it("rejects non-gateway callback", async function () {
    const { longTrader, shortTrader, intruder, orderBook, matcher } = await deployFixture();

    await submitEncryptedLong(orderBook, longTrader, 3000, 10);
    await submitEncryptedShort(orderBook, shortTrader, 3000, 10);

    const handles = await matcher.getPendingHandles(1);
    const decryptRes = await fhevm.publicDecrypt(handles);

    await expect(
      matcher.connect(intruder).resolveMatchWithProof(1, decryptRes.abiEncodedClearValues, decryptRes.decryptionProof)
    ).to.be.revertedWith("only gateway");
  });
});
