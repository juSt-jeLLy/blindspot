import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

describe("DarkPool integration: encrypted submit -> proof-verified resolve", function () {
  async function deployFixture() {
    const [deployer, seller, buyer, gateway, intruder] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockConfidentialERC20");
    const cTokenA = await MockToken.deploy();
    const cTokenB = await MockToken.deploy();

    const Settlement = await ethers.getContractFactory("DarkPoolSettlement");
    const settlement = await Settlement.deploy(await cTokenA.getAddress(), await cTokenB.getAddress());

    const Matcher = await ethers.getContractFactory("DarkPoolMatcher");
    const matcher = await Matcher.deploy(await settlement.getAddress(), await gateway.getAddress());

    const Escrow = await ethers.getContractFactory("DarkPoolEscrow");
    const escrow = await Escrow.deploy(await cTokenA.getAddress(), await cTokenB.getAddress(), await matcher.getAddress());

    await matcher.connect(deployer).setEscrow(await escrow.getAddress());
    await settlement.connect(deployer).setMatcher(await matcher.getAddress());

    return { seller, buyer, gateway, intruder, escrow, matcher };
  }

  async function submitEncryptedSell(escrow: any, seller: any, price: number, size: number) {
    const input = fhevm.createEncryptedInput(await escrow.getAddress(), await seller.getAddress());
    input.add64(price);
    input.add64(size);
    const enc = await input.encrypt();

    await escrow.connect(seller).submitSellOrder(enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof);
  }

  async function submitEncryptedBuy(escrow: any, buyer: any, price: number, size: number) {
    const input = fhevm.createEncryptedInput(await escrow.getAddress(), await buyer.getAddress());
    input.add64(price);
    input.add64(size);
    const enc = await input.encrypt();

    await escrow.connect(buyer).submitBuyOrder(enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof);
  }

  async function resolveWithProof(matcher: any, gateway: any, requestId: number) {
    const handles = await matcher.getPendingHandles(requestId);
    const decryptRes = await fhevm.publicDecrypt(handles);
    await matcher.connect(gateway).resolveMatchWithProof(requestId, decryptRes.abiEncodedClearValues, decryptRes.decryptionProof);
  }

  it("full fill: marks both orders filled", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await submitEncryptedSell(escrow, seller, 100, 10);
    await submitEncryptedBuy(escrow, buyer, 100, 10);

    await resolveWithProof(matcher, gateway, 1);

    const sell = await escrow.orders(1);
    const buy = await escrow.orders(2);

    expect(sell.status).to.equal(3n);
    expect(buy.status).to.equal(3n);
  });

  it("partial fill: requeues seller remainder", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await submitEncryptedSell(escrow, seller, 100, 10);
    await submitEncryptedBuy(escrow, buyer, 120, 6);

    await resolveWithProof(matcher, gateway, 1);

    const oldSell = await escrow.orders(1);
    const buy = await escrow.orders(2);
    const newSell = await escrow.orders(3);

    expect(oldSell.status).to.equal(2n);
    expect(buy.status).to.equal(3n);
    expect(newSell.status).to.equal(1n);
  });

  it("no match: rotates one side and keeps orders pending", async function () {
    const { seller, buyer, gateway, escrow, matcher } = await deployFixture();

    await submitEncryptedSell(escrow, seller, 130, 10);
    await submitEncryptedBuy(escrow, buyer, 100, 10);

    await resolveWithProof(matcher, gateway, 1);

    const sell = await escrow.orders(1);
    const buy = await escrow.orders(2);

    expect(sell.status).to.equal(1n);
    expect(buy.status).to.equal(1n);
  });

  it("rejects non-gateway callback", async function () {
    const { seller, buyer, intruder, escrow, matcher } = await deployFixture();

    await submitEncryptedSell(escrow, seller, 100, 10);
    await submitEncryptedBuy(escrow, buyer, 100, 10);

    const handles = await matcher.getPendingHandles(1);
    const decryptRes = await fhevm.publicDecrypt(handles);

    await expect(
      matcher.connect(intruder).resolveMatchWithProof(1, decryptRes.abiEncodedClearValues, decryptRes.decryptionProof)
    ).to.be.revertedWith("only gateway");
  });
});
