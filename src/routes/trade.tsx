import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { PairKey } from "@/lib/contracts-config";
import { LIVE_PAIRS } from "@/lib/live-pairs";
import { decryptHandleForUser, encryptOrderInputs } from "@/lib/fhe";
import { formatUnits } from "ethers";
import {
  type Side,
  approveConfidentialForEscrow,
  approveUnderlyingForWrapper,
  getBrowserProvider,
  getFundingContractsForPair,
  getFundingStatus,
  submitEncryptedOrder,
  wrapIntoConfidential,
} from "@/lib/web3";

export const Route = createFileRoute("/trade")({ component: Trade });

function isZeroHandle(handle?: string | null) {
  return !handle || /^0x0{64}$/i.test(handle);
}

function Trade() {
  const [pairId, setPairId] = useState<string>(LIVE_PAIRS[0]?.key ?? "WETH_USDC");
  const [side, setSide] = useState<Side>("Buy");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fundingInfo, setFundingInfo] = useState<any>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);

  const pair = LIVE_PAIRS.find((p) => p.key === pairId) ?? LIVE_PAIRS[0];
  const fundingToken = side === "Buy" ? pair?.tokenB : pair?.tokenA;

  const notional = useMemo(() => {
    if (!price || !size) return "—";
    return (Number(price) * Number(size)).toFixed(6);
  }, [price, size]);

  async function refreshFundingInfo() {
    if (!pair) return;
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const funding = await getFundingContractsForPair({ pairKey: pair.key as PairKey, side });
      const info = await getFundingStatus({
        underlyingToken: funding.underlyingToken,
        cToken: funding.cToken,
        escrow: pair.escrow,
        owner,
        signer,
      });

      if (isZeroHandle(info.confidentialBalanceHandle)) {
        info.confidentialBalance = "0";
      } else {
        try {
          const decrypted = await decryptHandleForUser({
            handle: info.confidentialBalanceHandle,
            contractAddress: funding.cToken,
            userAddress: owner,
            signer,
          });
          info.confidentialBalance = formatUnits(decrypted, 6);
        } catch (e: any) {
          setFundingError(`decrypt failed: ${e?.message ?? "unknown"}`);
        }
      }

      setFundingInfo(info);
      if (!fundingError) setFundingError(null);
    } catch (e: any) {
      setFundingError(e?.message ?? "status read failed");
      setFundingInfo(null);
    }
  }

  async function handlePrepareFunding() {
    if (!pair || !fundAmount) return;
    setSubmitting(true);
    try {
      const funding = await getFundingContractsForPair({ pairKey: pair.key as PairKey, side });
      await approveUnderlyingForWrapper({
        underlyingToken: funding.underlyingToken,
        wrapperToken: funding.cToken,
        amountHuman: fundAmount,
      });
      await wrapIntoConfidential({ wrapperToken: funding.cToken, amountHuman: fundAmount });
      await approveConfidentialForEscrow({ cToken: funding.cToken, escrow: pair.escrow, amountHuman: fundAmount });
      setStatus("✓ Funding ready");
      await refreshFundingInfo();
    } catch (e: any) {
      setStatus(`✕ Funding flow failed: ${e?.message ?? "unknown"}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pair || !price || !size) return;
    setSubmitting(true);
    setStatus("Encrypting...");
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const encrypted = await encryptOrderInputs({
        contractAddress: pair.escrow,
        userAddress,
        priceDecimal: price,
        sizeDecimal: size,
      });
      const res = await submitEncryptedOrder({
        pairKey: pair.key as PairKey,
        side,
        encPriceHandle: encrypted.encPriceHandle,
        priceProof: encrypted.inputProof,
        encSizeHandle: encrypted.encSizeHandle,
        sizeProof: encrypted.inputProof,
      });
      setStatus(`✓ Submitted: ${res.txHash}`);
    } catch (e: any) {
      setStatus(`✕ Submit failed: ${e?.message ?? "unknown"}`);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    refreshFundingInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairId, side]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex gap-3">
        <select value={pairId} onChange={(e) => setPairId(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-sm">
          {LIVE_PAIRS.map((p) => <option key={p.key} value={p.key}>{p.tokenA}/{p.tokenB}</option>)}
        </select>
        <button onClick={() => setSide("Buy")} className="rounded border px-3 py-2">Buy</button>
        <button onClick={() => setSide("Sell")} className="rounded border px-3 py-2">Sell</button>
      </div>

      <form onSubmit={submit} className="space-y-3 rounded border border-border p-4">
        <div className="text-xs text-muted-foreground">Funding token for current side: {fundingToken}</div>
        <input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} placeholder={`Funding Amount (${fundingToken})`} className="w-full rounded border border-border bg-background px-3 py-2" />
        <button type="button" onClick={handlePrepareFunding} disabled={submitting || !fundAmount} className="w-full rounded border border-border px-3 py-2">Prepare Funding (Approve → Wrap → Approve Escrow)</button>

        <div className="rounded border border-dashed border-border p-3 text-sm">
          <div>Underlying Balance: {fundingInfo?.underlyingBalance ?? "—"} {fundingToken}</div>
          <div>Approved to Wrapper: {fundingInfo?.underlyingAllowanceToWrapper ?? "—"} {fundingToken}</div>
          <div>Available for Trading (confidential): {fundingInfo?.confidentialBalance ?? "—"} c{fundingToken}</div>
          <div>Confidential Balance Handle: {fundingInfo?.confidentialBalanceHandle?.slice(0, 12) ?? "—"}...</div>
          <div>Escrow Permission: {fundingInfo ? (fundingInfo.escrowOperatorEnabled ? "Enabled" : "Not enabled") : "—"}</div>
          {fundingError && <div className="text-xs text-destructive">status read failed: {fundingError}</div>}
          <button type="button" onClick={refreshFundingInfo} className="mt-2 w-full rounded border border-border px-3 py-2">Refresh Funding Status</button>
        </div>

        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" className="w-full rounded border border-border bg-background px-3 py-2" />
        <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size" className="w-full rounded border border-border bg-background px-3 py-2" />
        <div className="text-xs">Est. Notional: {notional}</div>
        <button type="submit" disabled={submitting || !price || !size} className="w-full rounded border border-primary bg-primary/10 px-3 py-2">Encrypt & Submit {side}</button>
        {status && <div className="text-sm">{status}</div>}
      </form>
    </div>
  );
}

export default Trade;
