import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";

const navLinks = [
  { to: "/trade", label: "Trade" },
  { to: "/pools", label: "Pools" },
  { to: "/orders", label: "My Orders" },
  { to: "/activity", label: "Activity" },
] as const;

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function Layout() {
  const [wallet, setWallet] = useState<string | null>(
    "0x4A8b9e2C3dF1a7B6c5E9f0a2D1C3b4E5F6A7B8C9",
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-primary">
            <span className="text-lg leading-none">⬛</span>
            <span className="text-sm font-bold tracking-[0.2em]">BLINDSPOT</span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-primary"
                activeProps={{ className: "px-3 py-1.5 text-xs uppercase tracking-wider text-primary border-b border-primary" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-xs">
            {wallet ? (
              <>
                <span className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-primary">
                  {shortAddr(wallet)}
                </span>
                <span className="rounded border border-terminal-dim/40 px-2 py-1 text-terminal-dim">
                  SEPOLIA
                </span>
                <button
                  onClick={() => setWallet(null)}
                  className="rounded border border-border px-2 py-1 text-muted-foreground hover:border-destructive hover:text-destructive"
                >
                  ✕
                </button>
              </>
            ) : (
              <button
                onClick={() => setWallet("0x4A8b9e2C3dF1a7B6c5E9f0a2D1C3b4E5F6A7B8C9")}
                className="rounded border border-primary bg-primary/10 px-3 py-1 text-primary hover:bg-primary/20"
              >
                CONNECT WALLET
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-card">
        <div className="border-b border-destructive/40 bg-destructive/10 py-2 text-center text-xs text-destructive">
          ⚠ TESTNET ONLY — Sepolia. Tokens have no real value.
        </div>
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground md:flex-row md:justify-between">
          <div>
            <span className="text-primary">⬛ BLINDSPOT</span> · encrypted matching for institutional flow
          </div>
          <div className="flex gap-4">
            <a href="#" className="hover:text-primary">Docs</a>
            <a href="#" className="hover:text-primary">GitHub</a>
            <a href="#" className="hover:text-primary">Contracts</a>
            <a href="#" className="hover:text-primary">Discord</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
