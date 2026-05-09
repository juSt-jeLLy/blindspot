import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CONTRACTS } from "@/lib/contracts-config";
import { decryptHandleForUser } from "@/lib/fhe";
import {
  type PerpMarketKey,
  approveConfidentialForPerpManager,
  getBrowserProvider,
  getPerpFundingStatus,
  getPerpPosition,
  perpClosePosition,
  perpDepositCollateral,
  perpOpenPosition,
  perpWithdrawCollateral,
  requestPerpLiquidationCheck,
} from "@/lib/web3";
import { formatUnits } from "ethers";

export const Route = createFileRoute("/perps")({ component: PerpsPage });

function isZeroHandle(h?: string) {
  return !h || /^0x0{64}$/i.test(h);
}
function shortAddr(a: string) {
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
const TV_SYMBOL_BY_MARKET: Record<string, string> = {
  "WETH-PERP": "BINANCE:ETHUSDT",
  "WBTC-PERP": "BINANCE:BTCUSDT",
  "LINK-PERP": "BINANCE:LINKUSDT",
};

function PerpsPage() {
  const marketKeys = Object.keys(CONTRACTS.perps.markets) as PerpMarketKey[];
  const [marketKey, setMarketKey] = useState<PerpMarketKey>(marketKeys[0]);
  const market = CONTRACTS.perps.markets[marketKey];
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [freeCollateral, setFreeCollateral] = useState("0");
  const [lockedMargin, setLockedMargin] = useState("0");

  const [size, setSize] = useState("1000");
  const [leverage, setLeverage] = useState("5");
  const [lockCollateral, setLockCollateral] = useState("5");
  const [isLong, setIsLong] = useState(true);
  const [position, setPosition] = useState<any>(null);
  const [allPositions, setAllPositions] = useState<Array<{
    marketKey: PerpMarketKey;
    symbol: string;
    isOpen: boolean;
    isLong: boolean;
    collateralUsdc: string;
    entryPrice: string;
  }>>([]);
  const freeMarginNum = Number(freeCollateral || "0");
  const notionalNum = Number(size || "0");
  const leverageNum = Number(leverage || "0");
  const lockNum = Number(lockCollateral || "0");

  const requiredMargin = useMemo(() => {
    if (!notionalNum || !leverageNum) return 0;
    return notionalNum / leverageNum;
  }, [notionalNum, leverageNum]);

  const maxNotionalAtLeverage = useMemo(() => {
    if (!leverageNum) return 0;
    return freeMarginNum * leverageNum;
  }, [freeMarginNum, leverageNum]);

  const impossibleReason = useMemo(() => {
    if (leverageNum <= 0) return "Leverage must be > 0";
    if (notionalNum <= 0) return "Notional size must be > 0";
    if (lockNum <= 0) return "Margin to lock must be > 0";
    if (lockNum > freeMarginNum) return "Locked margin exceeds available margin";
    if (requiredMargin > lockNum) return "Locked margin is too low for this notional/leverage";
    return "";
  }, [leverageNum, notionalNum, lockNum, freeMarginNum, requiredMargin]);

  async function refresh() {
    setError(null);
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      setWallet(owner);

      const fs = await getPerpFundingStatus({ owner, signer, marketKey });
      setFreeCollateral(fs.freeCollateral);
      setLockedMargin(position?.isOpen ? position.collateralUsdc : "0");

      if (isZeroHandle(fs.encryptedHandle)) {
        // no-op: perps page now intentionally focuses on margin availability
      } else {
        try {
          await decryptHandleForUser({
            handle: fs.encryptedHandle,
            contractAddress: fs.cToken,
            userAddress: owner,
            signer,
          });
        } catch {
          // no-op
        }
      }

      const p = await getPerpPosition(marketKey, owner);
      setPosition(p);
      setLockedMargin(p?.isOpen ? p.collateralUsdc : "0");

      const full = await Promise.all(
        marketKeys.map(async (k) => {
          const m = CONTRACTS.perps.markets[k];
          const row = await getPerpPosition(k, owner);
          return {
            marketKey: k,
            symbol: m.symbol,
            isOpen: row.isOpen,
            isLong: row.isLong,
            collateralUsdc: row.collateralUsdc,
            entryPrice: row.entryPrice,
          };
        }),
      );
      setAllPositions(full);
    } catch (e: any) {
      setError(e?.message ?? "refresh failed");
    }
  }

  async function openPosition() {
    setBusy(true);
    setError(null);
    setStatus("Opening position...");
    try {
      await perpOpenPosition({
        marketKey,
        isLong,
        collateralToLockHuman: lockCollateral,
        sizeHuman: size,
        leverageX: leverage,
      });
      setStatus("✓ Position opened");
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "open failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function closePosition() {
    setBusy(true);
    setError(null);
    setStatus("Closing position...");
    try {
      await perpClosePosition(marketKey);
      setStatus("✓ Position closed");
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "close failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function requestLiq() {
    setBusy(true);
    setError(null);
    setStatus("Requesting liquidation check...");
    try {
      await requestPerpLiquidationCheck(marketKey, wallet);
      setStatus("✓ Liquidation check requested");
    } catch (e: any) {
      setError(e?.message ?? "liq request failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [marketKey]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-4">
      <div className="rounded border border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">▸ perps terminal</div>
        <div className="mt-3 max-w-xs">
          <select
            value={marketKey}
            onChange={(e) => setMarketKey(e.target.value as PerpMarketKey)}
            className="w-full rounded border border-border bg-background px-4 py-4 text-3xl font-semibold text-primary"
          >
            {marketKeys.map((k) => (
              <option key={k} value={k}>{CONTRACTS.perps.markets[k].symbol}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span>Collateral: {CONTRACTS.perps.collateralSymbol}</span>
          <span className="text-muted-foreground">Type: Perpetual Futures</span>
        </div>
        <div className="text-sm text-muted-foreground">Wallet: {wallet || "Not connected"}</div>
        <div className="text-xs text-muted-foreground mt-1">
          Trading <span className="text-foreground">{market.symbol}</span> perpetuals with margin in {CONTRACTS.perps.collateralSymbol}.
        </div>
      </div>

      <div className="rounded border border-border bg-card p-4">
        <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Price chart</div>
        <div className="h-[360px] w-full overflow-hidden rounded border border-border">
          <iframe
            title={`${market.symbol} Chart`}
            src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(
              TV_SYMBOL_BY_MARKET[market.symbol] || "BINANCE:ETHUSDT",
            )}&interval=15&theme=dark&style=1&timezone=Etc/UTC&toolbar_bg=%23000000&hide_top_toolbar=false&hide_legend=false&save_image=false`}
            className="h-full w-full"
          />
        </div>
      </div>

      <div className="rounded border border-border bg-card p-4">
        <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Position Status</div>
        <div className="mb-4 space-y-2 text-sm">
          <div>Available Margin ({market.symbol}): {freeCollateral} cUSDC</div>
          <div>Locked Margin ({market.symbol}): {lockedMargin} cUSDC</div>
          <div>Total Margin ({market.symbol}): {(Number(freeCollateral || "0") + Number(lockedMargin || "0")).toString()} cUSDC</div>
          <div className="text-xs text-muted-foreground">Need to add/withdraw? Use <Link to="/profile" className="text-primary underline">Profile</Link>.</div>
        </div>
        <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Open New Position</div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setIsLong(true)} className={`rounded border px-3 py-2 text-xs uppercase tracking-wider ${isLong ? "border-primary text-primary" : "border-border"}`}>Long</button>
            <button onClick={() => setIsLong(false)} className={`rounded border px-3 py-2 text-xs uppercase tracking-wider ${!isLong ? "border-destructive text-destructive" : "border-border"}`}>Short</button>
          </div>
          <label className="text-xs text-muted-foreground">Position size (USDC notional)</label>
          <input value={size} onChange={(e) => setSize(e.target.value)} className="w-full rounded border border-border bg-background px-3 py-2" placeholder="e.g. 1000" />
          <label className="text-xs text-muted-foreground">Leverage multiplier (x)</label>
          <input value={leverage} onChange={(e) => setLeverage(e.target.value)} className="w-full rounded border border-border bg-background px-3 py-2" placeholder="e.g. 5" />
          <label className="text-xs text-muted-foreground">Margin to lock (USDC)</label>
          <input value={lockCollateral} onChange={(e) => setLockCollateral(e.target.value)} className="w-full rounded border border-border bg-background px-3 py-2" placeholder="e.g. 5" />
          <div className="rounded border border-dashed border-border p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Required Margin</span><span>{requiredMargin.toFixed(6)} USDC</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Max Notional</span><span>{maxNotionalAtLeverage.toFixed(6)} USDC</span></div>
            {impossibleReason ? <div className="text-destructive">Invalid: {impossibleReason}</div> : <div className="text-primary">Valid setup.</div>}
          </div>
        </div>
        <div className="my-4 h-px bg-border" />
        {position?.isOpen ? (
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>Market: {market.symbol}</div>
            <div>Side: {position.isLong ? "Long" : "Short"}</div>
            <div>Entry Price: {position.entryPrice}</div>
            <div>Locked Collateral: {position.collateralUsdc} USDC</div>
            <div className="md:col-span-2">
              <button disabled={busy} onClick={closePosition} className="rounded border border-border px-3 py-2 text-xs uppercase tracking-wider mr-2">
                Close This Position
              </button>
              <button disabled={busy || !wallet} onClick={requestLiq} className="rounded border border-destructive px-3 py-2 text-xs uppercase tracking-wider text-destructive">
                Liq Check
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No open position for {market.symbol} on this wallet.
          </div>
        )}
        <div className="mt-3">
          <button disabled={busy || !!impossibleReason} onClick={openPosition} className="rounded border border-primary px-3 py-2 text-xs uppercase tracking-wider text-primary disabled:opacity-60">
            Open Position
          </button>
          <button disabled={busy} onClick={refresh} className="ml-2 rounded border border-border px-3 py-2 text-xs uppercase tracking-wider">
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-card p-4">
        <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">All Markets Positions</div>
        <div className="space-y-2 text-sm">
          {allPositions.filter((p) => p.isOpen).length === 0 ? (
            <div className="text-muted-foreground">No open positions across configured perp markets.</div>
          ) : (
            allPositions
              .filter((p) => p.isOpen)
              .map((p) => (
                <div key={p.marketKey} className="rounded border border-dashed border-border p-3 flex flex-wrap items-center gap-4">
                  <div className="font-semibold">{p.symbol}</div>
                  <div>Side: {p.isLong ? "Long" : "Short"}</div>
                  <div>Entry: {p.entryPrice}</div>
                  <div>Collateral: {p.collateralUsdc} USDC</div>
                  <button
                    onClick={() => setMarketKey(p.marketKey)}
                    className="rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wider"
                  >
                    View Market
                  </button>
                </div>
              ))
          )}
        </div>
      </div>

      {status && <div className="rounded border border-primary/40 bg-primary/10 p-2 text-sm text-primary">{status}</div>}
      {error && <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
    </div>
  );
}

export default PerpsPage;
