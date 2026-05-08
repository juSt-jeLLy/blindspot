import { expect } from "chai";
import { ethers } from "hardhat";

describe("DarkPool integration: submit -> resolve", function () {
  async function deployFixture() {
    const [deployer, seller, buyer, gateway, intruder] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockConfidentialERC20");
    const cTokenA = await MockToken.deploy();
    const cTokenB = await MockToken.deploy();

    const Settlement = await ethers.getContractFactory("DarkPoolSettlement");
    const settlement = await Settlement.deploy(await cTokenA.getAddress(), await cTokenB.getAddress());

    const Matcher = await ethers.getContractFactory("DarkPoolMatcher");
    const matcher = await Matcher.deploy(await settlement.getAddress(), await gateway.getAddress(), true);

    const Escrow = await ethers.getContractFactory("DarkPoolEscrow");
    const escrow = await Escrow.deploy(
      await cTokenA.getAddress(),
      await cTokenB.getAddress(),
      await matcher.getAddress(),
      true
    );

    await matcher.connect(deployer).setEscrow(await escrow.getAddress());
    await settlement.connect(deployer).setMatcher(await matcher.getAddress());

    return { deployer, seller, buyer, gateway, intruder, escrow, matcher };
  }

  it("full fill: marks both orders filled", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await escrow.connect(seller).submitSellOrderTest(100, 10);
    await escrow.connect(buyer).submitBuyOrderTest(100, 10);

    await matcher.connect(gateway).resolveMatch(1, true, true, 10, 0, 0);

    const sell = await escrow.orders(1);
    const buy = await escrow.orders(2);

    expect(sell.status).to.equal(3n);
    expect(buy.status).to.equal(3n);
    expect(await escrow.activeSellOrderId()).to.equal(0n);
    expect(await escrow.activeBuyOrderId()).to.equal(0n);
  });

  it("partial fill: requeues seller remainder", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await escrow.connect(seller).submitSellOrderTest(100, 10);
    await escrow.connect(buyer).submitBuyOrderTest(120, 6);

    await matcher.connect(gateway).resolveMatch(1, true, true, 6, 4, 0);

    const oldSell = await escrow.orders(1);
    const buy = await escrow.orders(2);
    const newSell = await escrow.orders(3);

    expect(oldSell.status).to.equal(2n);
    expect(buy.status).to.equal(3n);
    expect(newSell.status).to.equal(1n);
    expect(await escrow.activeSellOrderId()).to.equal(3n);
    expect(await escrow.activeBuyOrderId()).to.equal(0n);
  });

  it("no match: rotates one side and keeps orders pending", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await escrow.connect(seller).submitSellOrderTest(130, 10);
    await escrow.connect(buyer).submitBuyOrderTest(100, 10);

    await matcher.connect(gateway).resolveMatch(1, false, true, 0, 0, 0);

    const sell = await escrow.orders(1);
    const buy = await escrow.orders(2);

    expect(sell.status).to.equal(1n);
    expect(buy.status).to.equal(1n);
    expect(await escrow.activeSellOrderId()).to.equal(1n);
    expect(await escrow.activeBuyOrderId()).to.equal(2n);
  });

  it("rejects non-gateway resolve callback", async function () {
    const { seller, buyer, intruder, matcher, escrow } = await deployFixture();

    await escrow.connect(seller).submitSellOrderTest(100, 10);
    await escrow.connect(buyer).submitBuyOrderTest(100, 10);

    await expect(
      matcher.connect(intruder).resolveMatch(1, true, true, 10, 0, 0)
    ).to.be.revertedWith("only gateway");
  });

  it("processes multiple queued orders sequentially", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await escrow.connect(seller).submitSellOrderTest(100, 5); // order 1
    await escrow.connect(seller).submitSellOrderTest(101, 7); // order 2 queued
    await escrow.connect(buyer).submitBuyOrderTest(100, 5);   // order 3 -> matches order 1
    await escrow.connect(buyer).submitBuyOrderTest(101, 7);   // order 4 queued

    // First head match resolves order1/order3 and auto-triggers next head
    await matcher.connect(gateway).resolveMatch(1, true, true, 5, 0, 0);
    // Second head match resolves order2/order4
    await matcher.connect(gateway).resolveMatch(2, true, true, 7, 0, 0);

    const o1 = await escrow.orders(1);
    const o2 = await escrow.orders(2);
    const o3 = await escrow.orders(3);
    const o4 = await escrow.orders(4);

    expect(o1.status).to.equal(3n);
    expect(o2.status).to.equal(3n);
    expect(o3.status).to.equal(3n);
    expect(o4.status).to.equal(3n);
    expect(await escrow.activeSellOrderId()).to.equal(0n);
    expect(await escrow.activeBuyOrderId()).to.equal(0n);
  });

  it("completes a full opposite-side loop then keeps candidate pending", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await escrow.connect(seller).submitSellOrderTest(200, 5); // sell #1 high ask
    await escrow.connect(seller).submitSellOrderTest(210, 5); // sell #2 high ask
    await escrow.connect(buyer).submitBuyOrderTest(100, 5);   // buy #3 low bid
    await escrow.connect(buyer).submitBuyOrderTest(110, 5);   // buy #4 low bid

    // request 1: sell1 vs buy3 -> no match; rotate buy
    await matcher.connect(gateway).resolveMatch(1, false, true, 0, 0, 0);
    // request 2: sell1 vs buy4 -> no match; full buy loop complete -> rotate sell
    await matcher.connect(gateway).resolveMatch(2, false, true, 0, 0, 0);

    const s1 = await escrow.orders(1);
    const s2 = await escrow.orders(2);
    const b3 = await escrow.orders(3);
    const b4 = await escrow.orders(4);

    // all orders still pending (open)
    expect(s1.status).to.equal(1n);
    expect(s2.status).to.equal(1n);
    expect(b3.status).to.equal(1n);
    expect(b4.status).to.equal(1n);

    // sell candidate should have rotated after full opposite-side scan
    expect(await escrow.activeSellOrderId()).to.equal(2n);
  });
});
