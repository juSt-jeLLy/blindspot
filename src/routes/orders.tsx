import { TimeAgo } from "@/components/TimeAgo";
import { ALL_PAIR_KEYS } from "@/lib/contracts-config";
import { cancelOrder, fetchOrdersForAddress, getBrowserProvider, type ChainOrder } from "@/lib/web3";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StatusPill } from "./trade";

export const Route = createFileRoute("/orders")({ component: Orders });

function Orders() {
  const [rows, setRows] = useState<ChainOrder[]>([]);
  const [status, setStatus] = useState<string>("Connect wallet to load orders.");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      setStatus("Loading wallet + orders...");
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const list = await fetchOrdersForAddress(owner, ALL_PAIR_KEYS);
      setRows(list);
      setStatus(list.length ? "" : "No orders found for connected wallet.");
    } catch (e: any) {
      setStatus(`Could not load orders: ${e?.message ?? "unknown"}`);
      setRows([]);
    }
  }

  async function onCancel(r: ChainOrder) {
    try {
      setBusy(r.orderId);
      await cancelOrder(r.pairKey, r.orderId);
      await load();
    } catch (e: any) {
      setStatus(`Cancel failed: ${e?.message ?? "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-sm uppercase tracking-widest text-muted-foreground">▸ My Orders</h1>
        <button onClick={load} className="rounded border border-border px-3 py-1 text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary">Refresh</button>
      </div>

      {status && <div className="mb-3 rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground">{status}</div>}

      <div className="overflow-hidden rounded border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-background/50 text-muted-foreground">
            <tr>
              <Th>Order ID</Th><Th>Pair</Th><Th>Side</Th><Th>Status</Th><Th>Timestamp</Th><Th>TX</Th><Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={`${o.pairKey}-${o.orderId}-${o.txHash}`} className="border-b border-border last:border-0 hover:bg-background/40">
                <Td className="font-mono text-foreground">{o.orderId}</Td>
                <Td>{o.pairLabel}</Td>
                <Td className={o.side === "Buy" ? "text-primary" : "text-destructive"}>{o.side}</Td>
                <Td><StatusPill status={o.status} /></Td>
                <Td className="text-muted-foreground"><TimeAgo ts={o.timestamp} /></Td>
                <Td className="font-mono text-[10px] text-terminal-dim">{o.txHash.slice(0, 10)}...</Td>
                <Td className="text-right">
                  {o.status === "Pending" ? (
                    <button
                      onClick={() => onCancel(o)}
                      disabled={busy === o.orderId}
                      className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-60"
                    >
                      {busy === o.orderId ? "..." : "Cancel"}
                    </button>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-left text-[10px] font-normal uppercase tracking-widest ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
