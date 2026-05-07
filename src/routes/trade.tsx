import { TimeAgo } from "@/components/TimeAgo";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PAIRS, ORDERS, type Side } from "@/lib/mock";

export const Route = createFileRoute("/trade")({
  head: () => ({ meta: [{ title: "Trade — Blindspot" }, { name: "description", content: "Submit encrypted buy/sell orders to Blindspot's FHE matching engine." }] }),
  component: Trade,
});

function Trade() {
  const [pairId, setPairId] = useState(PAIRS[0].id);
  const [side, setSide] = useState<Side>("Buy");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pair = PAIRS.find((p) => p.id === pairId)!;
  const pairLabel = `${pair.tokenA}/${pair.tokenB}`;
  const pairOrders = useMemo(() => ORDERS.filter((o) => o.pair === pairLabel), [pairLabel]);

  const isBuy = side === "Buy";
  const accent = isBuy ? "primary" : "destructive";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus("⌬ ENCRYPTING PAYLOAD…");
    setTimeout(() => setStatus("▸ BROADCASTING TO MATCHER…"), 700);
    setTimeout(() => setStatus("● SUBMITTED · awaiting match"), 1500);
    setTimeout(() => { setStatus(null); setSubmitting(false); }, 4500);
    setSize(""); setPrice("");
  }

  const notional = size && price ? (parseFloat(size) * parseFloat(price)).toFixed(2) : "—";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header strip */}
      <div className="mb-6 flex flex-col gap-3 rounded border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">▸ trade terminal</div>
            <div className="mt-1 text-lg text-foreground">
              {pair.tokenA}<span className="text-muted-foreground">/</span>{pair.tokenB}
            </div>
          </div>
          <div className="hidden h-10 w-px bg-border md:block" />
          <div className="hidden md:block">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">last match</div>
            <div className="text-xs text-primary">[ENCRYPTED]</div>
          </div>
          <div className="hidden md:block">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">depth</div>
            <div className="text-xs text-foreground">{pairOrders.length} active</div>
          </div>
        </div>
        <div className="relative">
          <select
            value={pairId}
            onChange={(e) => setPairId(e.target.value)}
            className="appearance-none rounded border border-border bg-background px-4 py-2 pr-8 text-sm text-primary focus:border-primary focus:outline-none"
          >
            {PAIRS.map((p) => (
              <option key={p.id} value={p.id}>{p.tokenA}/{p.tokenB}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-primary">▾</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* Order ticket */}
        <div className="rounded border border-border bg-card">
          {/* Side toggle */}
          <div className="grid grid-cols-2">
            {(["Buy", "Sell"] as const).map((s) => {
              const active = side === s;
              const isB = s === "Buy";
              return (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`relative py-3 text-xs uppercase tracking-[0.3em] transition ${
                    active
                      ? isB
                        ? "bg-primary/10 text-primary"
                        : "bg-destructive/10 text-destructive"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isB ? "▲ BUY" : "▼ SELL"}
                  {active && (
                    <span className={`absolute inset-x-0 bottom-0 h-px ${isB ? "bg-primary" : "bg-destructive"}`} />
                  )}
                </button>
              );
            })}
          </div>

          <form onSubmit={submit} className="space-y-5 p-6">
            <Field
              label="Size"
              suffix={pair.tokenA}
              value={size}
              onChange={setSize}
              accent={accent}
            />
            <Field
              label="Limit Price"
              suffix={pair.tokenB}
              value={price}
              onChange={setPrice}
              accent={accent}
            />

            {/* Quick-percentage chips */}
            <div className="flex gap-2">
              {["25%", "50%", "75%", "MAX"].map((p) => (
                <button
                  key={p}
                  type="button"
                  className="flex-1 rounded border border-border bg-background py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary/50 hover:text-primary"
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="space-y-1.5 rounded border border-dashed border-border bg-background/40 p-3 text-[11px]">
              <Row label="Est. Notional" value={`${notional} ${pair.tokenB}`} />
              <Row label="Network Fee" value="~0.0008 ETH" />
              <Row label="Privacy" value="FHE · client-side" valueClass="text-primary" />
            </div>

            <div className="flex items-start gap-2 rounded border border-primary/30 bg-primary/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
              <span className="mt-0.5 text-primary">⌬</span>
              <span>
                Inputs are encrypted in your browser via fully homomorphic encryption.
                The matcher computes on ciphertext — neither operators nor MEV bots
                can read your size or price.
              </span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={`group relative w-full overflow-hidden rounded border px-4 py-3.5 text-xs uppercase tracking-[0.3em] transition disabled:opacity-60 ${
                isBuy
                  ? "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
              }`}
            >
              <span className="relative z-10">⌬ Encrypt &amp; Submit {side}</span>
            </button>

            {status && (
              <div className={`rounded border px-3 py-2 text-center text-[11px] uppercase tracking-widest ${
                isBuy ? "border-primary/40 bg-primary/5 text-primary" : "border-destructive/40 bg-destructive/5 text-destructive"
              }`}>
                {status}
              </div>
            )}
          </form>
        </div>

        {/* Order book / status panel */}
        <aside className="rounded border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">▸ active orders</h2>
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              live
            </span>
          </div>
          {pairOrders.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              <div className="mb-2 text-2xl text-terminal-dim">∅</div>
              No active orders for {pairLabel}.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {pairOrders.map((o) => (
                <li key={o.id} className="px-4 py-3 text-xs hover:bg-background/40">
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] ${o.side === "Buy" ? "text-primary" : "text-destructive"}`}>
                      {o.side === "Buy" ? "▲" : "▼"} {o.side.toUpperCase()}
                    </span>
                    <StatusPill status={o.status} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                    <span className="font-mono">{o.id}</span>
                    <span><TimeAgo ts={o.timestamp} /></span>
                  </div>
                  <div className="mt-1 text-[10px] text-terminal-dim">size: ▒▒▒▒▒▒</div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-4 py-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            sizes hidden · fhe-encrypted
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = "text-foreground" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function Field({
  label, suffix, value, onChange, accent,
}: { label: string; suffix: string; value: string; onChange: (v: string) => void; accent: "primary" | "destructive" }) {
  const focusRing = accent === "primary" ? "focus-within:border-primary" : "focus-within:border-destructive";
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</span>
        <span className="text-[10px] uppercase tracking-widest text-terminal-dim">{suffix}</span>
      </div>
      <div className={`flex items-center rounded border border-border bg-background px-3 transition ${focusRing}`}>
        <span className="mr-2 text-muted-foreground">$</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          className="w-full bg-transparent py-2.5 text-base text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
        <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">{suffix}</span>
      </div>
    </label>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    Open: "border-primary/40 text-primary bg-primary/10",
    Locked: "border-yellow-500/40 text-yellow-500 bg-yellow-500/10",
    Matched: "border-primary/40 text-primary bg-primary/10",
    Cancelled: "border-destructive/40 text-destructive bg-destructive/10",
  };
  return (
    <span className={`rounded border px-2 py-0.5 text-[9px] uppercase tracking-widest ${map[status] ?? "border-border text-muted-foreground"}`}>
      {status}
    </span>
  );
}
