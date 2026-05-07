import { TimeAgo } from "@/components/TimeAgo";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { ORDERS } from "@/lib/mock";
import { StatusPill } from "./trade";

export const Route = createFileRoute("/orders")({
  head: () => ({ meta: [{ title: "My Orders — Blindspot" }, { name: "description", content: "Your private encrypted order history." }] }),
  component: Orders,
});

function Orders() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  function decrypt(id: string) {
    setRevealed((r) => ({ ...r, [id]: (Math.random() * 5 + 0.1).toFixed(4) }));
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-sm uppercase tracking-widest text-muted-foreground">▸ My Orders</h1>

      <div className="overflow-hidden rounded border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-background/50 text-muted-foreground">
            <tr>
              <Th>Order ID</Th><Th>Pair</Th><Th>Side</Th><Th>Status</Th><Th>Timestamp</Th><Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {ORDERS.map((o) => (
              <Fragment key={o.id}>
                <tr
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-background/40"
                >
                  <Td className="text-foreground">{o.id}</Td>
                  <Td>{o.pair}</Td>
                  <Td className={o.side === "Buy" ? "text-primary" : "text-destructive"}>{o.side}</Td>
                  <Td><StatusPill status={o.status} /></Td>
                  <Td className="text-muted-foreground"><TimeAgo ts={o.timestamp} /></Td>
                  <Td className="text-right">
                    {o.status === "Open" ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); }}
                        className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10"
                      >
                        Cancel
                      </button>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </Td>
                </tr>
                {expanded === o.id && (
                  <tr className="border-b border-border bg-background/30">
                    <td colSpan={6} className="px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Encrypted Size</div>
                          <div className="mt-1 font-mono text-xs text-primary">{o.encryptedSize}</div>
                        </div>
                        <div className="flex items-end justify-between gap-3">
                          <div className="flex-1">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Decrypted Fill</div>
                            <div className="mt-1 font-mono text-xs text-foreground">
                              {revealed[o.id] ? `${revealed[o.id]} ${o.pair.split("/")[0]}` : "▒▒▒▒▒▒▒"}
                            </div>
                          </div>
                          <button
                            onClick={() => decrypt(o.id)}
                            className="rounded border border-primary bg-primary/10 px-3 py-1.5 text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20"
                          >
                            ⌬ Decrypt
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
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
