import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getBrowserProvider, getConfidentialTokenStatus, getConfidentialTokens, unwrapConfidentialToUnderlying } from "@/lib/web3";
import { decryptHandleForUser } from "@/lib/fhe";
import { formatUnits } from "ethers";

type Row = {
  cToken: string;
  cSymbol: string;
  underlying: string;
  underlyingSymbol: string;
  underlyingBalance: string;
  encryptedHandle: string;
  decryptedBalance?: string;
  unwrapAmount?: string;
  busy?: boolean;
  error?: string;
  status?: string;
};

export const Route = createFileRoute("/profile")({ component: ProfilePage });

function isZeroHandle(handle: string) {
  return /^0x0{64}$/i.test(handle);
}

function shortAddr(a: string) {
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

function ProfilePage() {
  const [wallet, setWallet] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setGlobalError(null);
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      setWallet(owner);

      const list = getConfidentialTokens();
      const nextRows: Row[] = [];
      for (const token of list) {
        const s = await getConfidentialTokenStatus({ cToken: token.address, owner, signer });
        nextRows.push({
          ...s,
          decryptedBalance: isZeroHandle(s.encryptedHandle) ? "0" : undefined,
          unwrapAmount: "",
        });
      }
      setRows(nextRows);
    } catch (e: any) {
      setGlobalError(e?.message ?? "failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  async function decryptRow(i: number) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, busy: true, error: undefined, status: "Decrypting..." } : r)));
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const row = rows[i];
      if (isZeroHandle(row.encryptedHandle)) {
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, decryptedBalance: "0", busy: false, status: "✓ No confidential balance" } : r)));
        return;
      }
      const value = await decryptHandleForUser({
        handle: row.encryptedHandle,
        contractAddress: row.cToken,
        userAddress,
        signer,
      });
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, decryptedBalance: formatUnits(value, 6), busy: false, status: "✓ Decrypted" } : r)));
    } catch (e: any) {
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, busy: false, error: e?.message ?? "decrypt failed", status: undefined } : r)));
    }
  }

  async function unwrapRow(i: number) {
    const row = rows[i];
    const amount = (row.unwrapAmount ?? "").trim();
    if (!amount) return;
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, busy: true, error: undefined, status: "Unwrapping..." } : r)));
    try {
      const res = await unwrapConfidentialToUnderlying({ cToken: row.cToken, amountHuman: amount });
      setRows((prev) =>
        prev.map((r, idx) =>
          idx === i
            ? {
                ...r,
                busy: false,
                status: `✓ Unwrapped (${res.unwrapTxHash.slice(0, 10)}..., ${res.finalizeTxHash.slice(0, 10)}...)`,
                unwrapAmount: "",
              }
            : r,
        ),
      );
      await load();
    } catch (e: any) {
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, busy: false, error: e?.message ?? "unwrap failed", status: undefined } : r)));
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 rounded border border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">▸ profile / portfolio</div>
        <div className="mt-2 text-sm text-foreground">Wallet: {wallet ? shortAddr(wallet) : "Not connected"}</div>
        <button onClick={load} className="mt-3 rounded border border-border px-3 py-2 text-xs uppercase tracking-wider hover:border-primary hover:text-primary">
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        {globalError && <div className="mt-3 text-sm text-destructive">{globalError}</div>}
      </div>

      <div className="space-y-4">
        {rows.map((row, i) => (
          <div key={row.cToken} className="rounded border border-border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm uppercase tracking-[0.2em] text-primary">{row.cSymbol} / {row.underlyingSymbol}</div>
              <div className="font-mono text-xs text-muted-foreground">{shortAddr(row.cToken)}</div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div className="text-muted-foreground">Underlying Wallet Balance</div>
              <div>{row.underlyingBalance} {row.underlyingSymbol}</div>
              <div className="text-muted-foreground">Confidential Balance Handle</div>
              <div className="font-mono">{shortAddr(row.encryptedHandle)}</div>
              <div className="text-muted-foreground">Confidential Balance (decrypted)</div>
              <div>{row.decryptedBalance ?? "Encrypted" } {row.cSymbol}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                disabled={row.busy}
                onClick={() => decryptRow(i)}
                className="rounded border border-border px-3 py-2 text-xs uppercase tracking-wider hover:border-primary hover:text-primary disabled:opacity-60"
              >
                Decrypt Balance
              </button>
              <input
                value={row.unwrapAmount ?? ""}
                onChange={(e) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, unwrapAmount: e.target.value } : r)))}
                placeholder={`Unwrap amount (${row.cSymbol})`}
                className="min-w-52 flex-1 rounded border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                disabled={row.busy || !(row.unwrapAmount ?? "").trim()}
                onClick={() => unwrapRow(i)}
                className="rounded border border-primary bg-primary/10 px-3 py-2 text-xs uppercase tracking-wider text-primary disabled:opacity-60"
              >
                Unwrap to {row.underlyingSymbol}
              </button>
            </div>
            {row.status && <div className="mt-2 text-sm text-primary">{row.status}</div>}
            {row.error && <div className="mt-2 text-sm text-destructive">{row.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProfilePage;
