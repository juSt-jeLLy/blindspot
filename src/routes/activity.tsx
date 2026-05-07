import { TimeAgo } from "@/components/TimeAgo";
import { createFileRoute } from "@tanstack/react-router";
import { ACTIVITY, type ActivityEvent } from "@/lib/mock";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/activity")({
  head: () => ({ meta: [{ title: "Activity — Blindspot" }, { name: "description", content: "Live encrypted match feed across all Blindspot pairs." }] }),
  component: Activity,
});

const TYPES = ["MATCHED", "NO_MATCH", "PARTIAL_FILL", "SETTLED"] as const;
const PAIRS_LIST = ["WBTC/USDC", "WETH/USDC", "LINK/USDC", "UNI/WETH", "ARB/USDC"];

function randHex(n = 5) {
  return "0x" + Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
}

function Activity() {
  const [events, setEvents] = useState<ActivityEvent[]>(ACTIVITY);

  useEffect(() => {
    const id = setInterval(() => {
      setEvents((e) =>
        [
          {
            id: crypto.randomUUID(),
            orderId: randHex(5),
            pair: PAIRS_LIST[Math.floor(Math.random() * PAIRS_LIST.length)],
            type: TYPES[Math.floor(Math.random() * TYPES.length)],
            timestamp: Date.now(),
          },
          ...e,
        ].slice(0, 50),
      );
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-sm uppercase tracking-widest text-muted-foreground">▸ Public Activity Feed</h1>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-primary">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" /> live
        </div>
      </div>

      <div className="rounded border border-border bg-card font-mono text-xs">
        <div className="border-b border-border px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          $ tail -f /var/log/blindspot/events
        </div>
        <ul className="max-h-[70vh] divide-y divide-border overflow-auto">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[80px_1fr_120px_90px] items-center gap-3 px-4 py-2 hover:bg-background/40">
              <EventTag type={e.type} />
              <span className="text-foreground">{e.orderId} <span className="text-muted-foreground">@</span> {e.pair}</span>
              <span className="text-terminal-dim text-[10px]">amount: ▒▒▒▒</span>
              <span className="text-right text-muted-foreground"><TimeAgo ts={e.timestamp} /></span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
        amounts are never broadcast · only event types and order ids are public
      </p>
    </div>
  );
}

function EventTag({ type }: { type: ActivityEvent["type"] }) {
  const map = {
    MATCHED: "border-primary/40 text-primary bg-primary/10",
    SETTLED: "border-primary/40 text-primary bg-primary/10",
    NO_MATCH: "border-destructive/40 text-destructive bg-destructive/10",
    PARTIAL_FILL: "border-yellow-500/40 text-yellow-500 bg-yellow-500/10",
  } as const;
  return (
    <span className={`rounded border px-2 py-0.5 text-center text-[9px] uppercase tracking-widest ${map[type]}`}>
      {type}
    </span>
  );
}
