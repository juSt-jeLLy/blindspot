import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

describe("Perp position + liquidation (FHE)", function () {
  async function deployFixture() {
    const [owner, trader, liquidator, gateway, intruder] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockConfidentialERC20");
    const usdc = await Token.deploy();

    const Oracle = await ethers.getContractFactory("PerpOracle");
    const oracle = await Oracle.deploy(await owner.getAddress(), 3000n * 10n ** 8n);

    const PM = await ethers.getContractFactory("PerpPositionManager");
    const pm = await PM.deploy(await owner.getAddress(), await usdc.getAddress(), await oracle.getAddress());

    const Liq = await ethers.getContractFactory("PerpLiquidationEngine");
    const liq = await Liq.deploy(await owner.getAddress(), await gateway.getAddress(), await pm.getAddress(), 500, 50);

    await pm.connect(owner).setLiquidationEngine(await liq.getAddress());

    return { owner, trader, liquidator, gateway, intruder, usdc, oracle, pm, liq };
  }

  async function encOpenInputs(pm: any, trader: any, size: number, levE6: number) {
    const input = fhevm.createEncryptedInput(await pm.getAddress(), await trader.getAddress());
    input.add64(size);
    input.add64(levE6);
    return input.encrypt();
  }

  it("opens and closes encrypted position", async function () {
    const { trader, usdc, pm } = await deployFixture();

    await pm.connect(trader).depositCollateral(10_000_000);

    const enc = await encOpenInputs(pm, trader, 5_000_000, 5_000_000);
    await pm.connect(trader).openPosition(enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof, true, 5_000_000);

    const p = await pm.getPosition(await trader.getAddress());
    expect(p.isOpen).to.eq(true);
    expect(p.collateralUsdc).to.eq(5_000_000n);

    await pm.connect(trader).closePosition();
    const p2 = await pm.getPosition(await trader.getAddress());
    expect(p2.isOpen).to.eq(false);
    expect(await pm.freeCollateral(await trader.getAddress())).to.eq(10_000_000n);
  });

  it("liquidates through proof-verified gateway callback", async function () {
    const { trader, liquidator, gateway, usdc, pm, liq } = await deployFixture();

    await pm.connect(trader).depositCollateral(10_000_000);

    // collateral lock = 5 USDC; exposure is intentionally large => liquidatable
    const enc = await encOpenInputs(pm, trader, 1_000_000_000, 20_000_000);
    await pm.connect(trader).openPosition(enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof, true, 5_000_000);

    await liq.connect(liquidator).requestLiquidationCheck(await trader.getAddress());
    const handles = await liq.getPendingHandles(1);
    const decryptRes = await fhevm.publicDecrypt(handles);

    await liq.connect(gateway).resolveLiquidationWithProof(1, decryptRes.abiEncodedClearValues, decryptRes.decryptionProof);

    const p = await pm.getPosition(await trader.getAddress());
    expect(p.isOpen).to.eq(false);
  });

  it("rejects non-gateway liquidation resolve", async function () {
    const { trader, liquidator, intruder, usdc, pm, liq } = await deployFixture();

    await pm.connect(trader).depositCollateral(10_000_000);

    const enc = await encOpenInputs(pm, trader, 1_000_000_000, 20_000_000);
    await pm.connect(trader).openPosition(enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof, true, 5_000_000);

    await liq.connect(liquidator).requestLiquidationCheck(await trader.getAddress());
    const handles = await liq.getPendingHandles(1);
    const decryptRes = await fhevm.publicDecrypt(handles);

    await expect(
      liq.connect(intruder).resolveLiquidationWithProof(1, decryptRes.abiEncodedClearValues, decryptRes.decryptionProof)
    ).to.be.revertedWith("only gateway");
  });
});
