import { createFileRoute, Link } from "@tanstack/react-router";
import { PAIRS } from "@/lib/mock";

export const Route = createFileRoute("/pools")({
  head: () => ({ meta: [{ title: "Pools — Blindspot" }, { name: "description", content: "Browse all registered FHE trading pairs on Blindspot." }] }),
  component: Pools,
});

function Pools() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-sm uppercase tracking-widest text-muted-foreground">▸ Registered Pairs</h1>
          <p className="mt-1 text-xs text-muted-foreground/70">{PAIRS.length} active markets · slot occupancy is binary (no amounts revealed)</p>
        </div>
        <button className="rounded border border-primary bg-primary/10 px-4 py-2 text-xs uppercase tracking-wider text-primary hover:bg-primary/20">
          + Create Pair
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PAIRS.map((p) => (
          <div key={p.id} className="rounded border border-border bg-card p-5 hover:border-primary/50">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg text-foreground">
                  {p.tokenA}<span className="text-muted-foreground">/</span>{p.tokenB}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">pair · {p.id}</div>
              </div>
              <span className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">FHE</span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
              <Slot label="BUY" filled={p.buySlot} side="buy" />
              <Slot label="SELL" filled={p.sellSlot} side="sell" />
            </div>

            <Link
              to="/trade"
              className="mt-5 block rounded border border-border py-2 text-center text-[11px] uppercase tracking-widest text-foreground hover:border-primary hover:text-primary"
            >
              ▸ Trade {p.tokenA}/{p.tokenB}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function Slot({ label, filled, side }: { label: string; filled: boolean; side: "buy" | "sell" }) {
  const filledCls =
    side === "buy"
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <div className={`rounded border p-2 ${filled ? filledCls : "border-border bg-background text-muted-foreground"}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-xs">{filled ? "● OCCUPIED" : "○ EMPTY"}</div>
    </div>
  );
}
