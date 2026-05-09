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
  getPerpCurrentPrice,
  getPerpPositionPnL,
  checkPerpLiquidatable,
  liquidatePosition,
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
  const [currentPrice, setCurrentPrice] = useState("0");
  const [pnlData, setPnlData] = useState<any>(null);
  const [isLiquidatable, setIsLiquidatable] = useState(false);

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

      // Get funding status
      const fs = await getPerpFundingStatus({ owner, signer, marketKey });
      setFreeCollateral(fs.freeCollateral);

      // Get current price
      try {
        const priceStr = await getPerpCurrentPrice(marketKey);
        setCurrentPrice(priceStr);
      } catch {
        setCurrentPrice("—");
      }

      // Get position
      const p = await getPerpPosition(marketKey, owner);
      setPosition(p);
      setLockedMargin(p?.isOpen ? p.collateralUsdc : "0");

      // Get P&L if position is open
      if (p?.isOpen) {
        try {
          const pnl = await getPerpPositionPnL(marketKey, owner);
          setPnlData(pnl);
        } catch (e) {
          setPnlData(null);
        }

        // Check liquidatable
        try {
          const liq = await checkPerpLiquidatable(marketKey, owner);
          setIsLiquidatable(liq);
        } catch {
          setIsLiquidatable(false);
        }
      } else {
        setPnlData(null);
        setIsLiquidatable(false);
      }

      // Get all positions
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
      setStatus("✓ Position opened at " + currentPrice);
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

  async function autoLiquidate() {
    setBusy(true);
    setError(null);
    setStatus("Auto-liquidating position...");
    try {
      await liquidatePosition(marketKey, wallet);
      setStatus("✓ Position liquidated");
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "liquidation failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [marketKey]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="rounded border border-border bg-card p-6">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">▸ perpetual futures</div>
            <select
              value={marketKey}
              onChange={(e) => setMarketKey(e.target.value as PerpMarketKey)}
              className="mt-2 rounded border border-border bg-background px-4 py-3 text-3xl font-bold text-primary"
            >
              {marketKeys.map((k) => (
                <option key={k} value={k}>{CONTRACTS.perps.markets[k].symbol}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 text-right">
            <div className="text-xs text-muted-foreground">Current Price</div>
            <div className="text-2xl font-bold text-foreground">${currentPrice}</div>
            <div className="text-xs text-muted-foreground">Collateral: {CONTRACTS.perps.collateralSymbol}</div>
          </div>
        </div>
      </div>

      {/* Price Chart */}
      <div className="rounded border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Live price chart</div>
        </div>
        <div className="h-[420px] w-full overflow-hidden">
          <iframe
            title={`${market.symbol} Chart`}
            src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(
              market.symbol === "WETH-PERP" ? "BINANCE:ETHUSDT" : 
              market.symbol === "WBTC-PERP" ? "BINANCE:BTCUSDT" : 
              "BINANCE:LINKUSDT",
            )}&interval=15&theme=dark&style=1&timezone=Etc/UTC&toolbar_bg=%23000000&hide_top_toolbar=false&hide_legend=false&save_image=false`}
            className="h-full w-full border-0"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Position Details */}
        <div className="rounded border border-border bg-card p-6">
          <div className="mb-4 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Current Position</div>
          
          {position?.isOpen ? (
            <div className="space-y-4">
              {/* Position Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded border border-dashed border-border p-3">
                  <div className="text-xs text-muted-foreground">Side</div>
                  <div className={`text-lg font-bold ${position.isLong ? "text-primary" : "text-destructive"}`}>
                    {position.isLong ? "▲ LONG" : "▼ SHORT"}
                  </div>
                </div>
                <div className="rounded border border-dashed border-border p-3">
                  <div className="text-xs text-muted-foreground">Entry Price</div>
                  <div className="text-lg font-bold">${position.entryPrice}</div>
                </div>
                <div className="rounded border border-dashed border-border p-3">
                  <div className="text-xs text-muted-foreground">Margin Locked</div>
                  <div className="text-lg font-bold">{position.collateralUsdc} USDC</div>
                </div>
                <div className="rounded border border-dashed border-border p-3">
                  <div className="text-xs text-muted-foreground">Current Price</div>
                  <div className="text-lg font-bold">${currentPrice}</div>
                </div>
              </div>

              {/* P&L Display */}
              {pnlData && (
                <div className={`rounded border p-4 ${pnlData.pnlStatus === "profit" ? "border-primary/40 bg-primary/5" : pnlData.pnlStatus === "loss" ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">Unrealized P&L</div>
                      <div className={`text-2xl font-bold ${pnlData.pnlStatus === "profit" ? "text-primary" : pnlData.pnlStatus === "loss" ? "text-destructive" : "text-foreground"}`}>
                        {pnlData.pnlPercent}%
                      </div>
                    </div>
                    <div className={`px-3 py-1 rounded text-xs font-semibold ${pnlData.pnlStatus === "profit" ? "bg-primary/20 text-primary" : pnlData.pnlStatus === "loss" ? "bg-destructive/20 text-destructive" : "bg-muted"}`}>
                      {pnlData.pnlStatus.toUpperCase()}
                    </div>
                  </div>
                </div>
              )}

              {/* Liquidation Status */}
              {isLiquidatable && (
                <div className="rounded border border-destructive/40 bg-destructive/10 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-destructive font-semibold">⚠ LIQUIDATABLE</div>
                      <div className="text-sm text-destructive/80 mt-1">Position health is critical. This position can be instantly liquidated.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="border-t border-border pt-4 space-y-2">
                <button 
                  disabled={busy} 
                  onClick={closePosition} 
                  className="w-full rounded border border-border px-3 py-2 text-sm uppercase tracking-wider hover:border-primary hover:text-primary disabled:opacity-60"
                >
                  ✕ Close Position
                </button>
                {isLiquidatable && (
                  <button 
                    disabled={busy} 
                    onClick={autoLiquidate} 
                    className="w-full rounded border border-destructive px-3 py-2 text-sm uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    ⚡ Auto-Liquidate Now
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded border border-dashed border-muted p-6 text-center">
              <div className="text-sm text-muted-foreground mb-2">No open position</div>
              <div className="text-xs text-muted-foreground">Create a new position using the form below.</div>
            </div>
          )}
        </div>

        {/* Open New Position Form */}
        <div className="rounded border border-border bg-card p-6">
          <div className="mb-4 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Create a New Trade</div>
          
          <div className="space-y-4">
            {/* Side Selection */}
            <div>
              <div className="text-xs text-muted-foreground mb-2">Direction</div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsLong(true)} 
                  className={`flex-1 rounded border px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${isLong ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  ▲ Long
                </button>
                <button 
                  onClick={() => setIsLong(false)} 
                  className={`flex-1 rounded border px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${!isLong ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  ▼ Short
                </button>
              </div>
            </div>

            {/* Inputs */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Position Size (USDC)</label>
              <input 
                type="number"
                value={size} 
                onChange={(e) => setSize(e.target.value)} 
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm" 
                placeholder="e.g. 1000" 
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Leverage (x)</label>
              <input 
                type="number"
                value={leverage} 
                onChange={(e) => setLeverage(e.target.value)} 
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm" 
                placeholder="e.g. 5" 
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Margin to Lock (USDC)</label>
              <input 
                type="number"
                value={lockCollateral} 
                onChange={(e) => setLockCollateral(e.target.value)} 
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm" 
                placeholder="e.g. 5" 
              />
            </div>

            {/* Summary */}
            <div className="rounded border border-dashed border-border p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Available Margin</span>
                <span className="font-semibold">{freeCollateral} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Required Margin</span>
                <span className="font-semibold">{requiredMargin.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Notional @ Leverage</span>
                <span className="font-semibold">${maxNotionalAtLeverage.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="font-bold text-foreground">${currentPrice}</span>
              </div>
              {impossibleReason && (
                <div className="text-destructive font-semibold">❌ {impossibleReason}</div>
              )}
            </div>

            {/* Action Button */}
            <button 
              disabled={busy || !!impossibleReason || !wallet} 
              onClick={openPosition} 
              className="w-full rounded border border-primary bg-primary/10 px-3 py-3 text-sm font-bold uppercase tracking-wider text-primary hover:bg-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              → Open Position
            </button>

            <button 
              disabled={busy} 
              onClick={refresh} 
              className="w-full rounded border border-border px-3 py-2 text-xs uppercase tracking-wider hover:border-primary hover:text-primary"
            >
              ↻ Refresh Data
            </button>
          </div>
        </div>
      </div>

      {/* All Positions */}
      {allPositions.filter(p => p.isOpen).length > 0 && (
        <div className="rounded border border-border bg-card p-6">
          <div className="mb-4 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">All Open Positions</div>
          <div className="space-y-3">
            {allPositions.filter(p => p.isOpen).map((p) => (
              <div key={p.marketKey} className="rounded border border-dashed border-border p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-foreground">{p.symbol}</div>
                  <div className="text-xs text-muted-foreground">{p.isLong ? "Long" : "Short"} @ ${p.entryPrice}</div>
                </div>
                <div className="text-sm">
                  <div className="text-muted-foreground text-xs">Margin</div>
                  <div className="font-semibold">{p.collateralUsdc} USDC</div>
                </div>
                <button
                  onClick={() => setMarketKey(p.marketKey)}
                  className="rounded border border-border px-3 py-1 text-xs uppercase tracking-wider hover:border-primary hover:text-primary"
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {status && <div className="rounded border border-primary/40 bg-primary/10 p-3 text-sm text-primary">{status}</div>}
      {error && <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    </div>
  );
}

export default PerpsPage;
