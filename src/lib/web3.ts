import { ethers } from "ethers";
import { CONTRACTS } from "@/lib/contracts-config";
import type { PairKey } from "@/lib/contracts-config";

const ESCROW_ABI = [
  "event SellOrderSubmitted(uint256 indexed orderId, address indexed seller)",
  "event BuyOrderSubmitted(uint256 indexed orderId, address indexed buyer)",
  "event OrderCancelled(uint256 indexed orderId, address indexed trader)",
  "function cTokenA() view returns (address)",
  "function cTokenB() view returns (address)",
  "function submitSellOrder(bytes32 encMinPrice, bytes priceProof, bytes32 encSellSize, bytes sizeProof) returns (uint256)",
  "function submitBuyOrder(bytes32 encBidPrice, bytes priceProof, bytes32 encBuySize, bytes sizeProof) returns (uint256)",
  "function cancelOrder(uint256 orderId)",
] as const;

const MATCHER_ABI = [
  "event MatchRequested(uint256 indexed requestId, uint256 indexed sellOrderId, uint256 indexed buyOrderId)",
  "event MatchResolved(uint256 indexed requestId, bool matched)",
  "event PartialFill(uint256 indexed requestId, uint256 indexed smallerOrderId, uint256 indexed remainderOrderId)",
] as const;

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const WRAPPER_ABI = [
  ...ERC20_ABI,
  "function underlying() view returns (address)",
  "function wrap(address to, uint256 amount) returns (bytes32)",
  "function setOperator(address operator, uint48 until)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
] as const;
const wrapperByUnderlyingCache = new Map<string, string>();

export type Side = "Buy" | "Sell";
export type OrderStatus = "Pending" | "Cancelled";

export type ChainOrder = {
  orderId: string;
  pairKey: PairKey;
  pairLabel: string;
  side: Side;
  trader: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  status: OrderStatus;
};

export type ChainActivity = {
  id: string;
  pairLabel: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  type: "MATCH_REQUESTED" | "MATCHED" | "NO_MATCH" | "PARTIAL_FILL";
};

const MAX_LOG_BLOCK_SPAN = 40_000;

function getEthereum(): ethers.Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { ethereum?: ethers.Eip1193Provider };
  return w.ethereum ?? null;
}

export function getBrowserProvider(): ethers.BrowserProvider {
  const eth = getEthereum();
  if (!eth) throw new Error("No injected wallet found");
  return new ethers.BrowserProvider(eth);
}

export function getRpcProvider(): ethers.JsonRpcProvider {
  const rpc = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SEPOLIA_RPC_URL
    || "https://ethereum-sepolia-rpc.publicnode.com";
  return new ethers.JsonRpcProvider(rpc, 11155111);
}

async function queryFilterChunked(
  contract: ethers.Contract,
  filter: ethers.EventFilter,
  provider: ethers.Provider,
  fromBlock = 0,
): Promise<ethers.EventLog[]> {
  const latest = await provider.getBlockNumber();
  const out: ethers.EventLog[] = [];
  for (let start = fromBlock; start <= latest; start += MAX_LOG_BLOCK_SPAN + 1) {
    const end = Math.min(start + MAX_LOG_BLOCK_SPAN, latest);
    const logs = await contract.queryFilter(filter, start, end);
    out.push(...(logs as ethers.EventLog[]));
  }
  return out;
}

export function getEscrowContract(pairKey: PairKey, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACTS.pairs[pairKey].escrow, ESCROW_ABI, signerOrProvider);
}

export async function submitEncryptedOrder(args: {
  pairKey: PairKey;
  side: Side;
  encPriceHandle: ethers.BytesLike;
  priceProof: ethers.BytesLike;
  encSizeHandle: ethers.BytesLike;
  sizeProof: ethers.BytesLike;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const escrow = getEscrowContract(args.pairKey, signer);
  const tx =
    args.side === "Sell"
      ? await escrow.submitSellOrder(args.encPriceHandle, args.priceProof, args.encSizeHandle, args.sizeProof)
      : await escrow.submitBuyOrder(args.encPriceHandle, args.priceProof, args.encSizeHandle, args.sizeProof);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function cancelOrder(pairKey: PairKey, orderId: string) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const escrow = getEscrowContract(pairKey, signer);
  const tx = await escrow.cancelOrder(BigInt(orderId));
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function getTokenMeta(token: string) {
  const provider = getRpcProvider();
  const c = new ethers.Contract(token, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
  return { symbol: String(symbol), decimals: Number(decimals) };
}

export async function getFundingStatus(args: {
  underlyingToken: string;
  cToken: string;
  escrow: string;
  owner: string;
  signer?: ethers.Signer;
}) {
  const provider = getRpcProvider();
  const u = new ethers.Contract(args.underlyingToken, ERC20_ABI, provider);
  const cRead = new ethers.Contract(
    args.cToken,
    [
      ...WRAPPER_ABI,
      "function isOperator(address holder, address spender) view returns (bool)",
    ],
    provider,
  );
  const cCaller = new ethers.Contract(
    args.cToken,
    [
      ...WRAPPER_ABI,
      "function isOperator(address holder, address spender) view returns (bool)",
    ],
    args.signer ?? provider,
  );

  const [uDecimals, uBal, uAllowance] = await Promise.all([
    u.decimals(),
    u.balanceOf(args.owner),
    u.allowance(args.owner, args.cToken),
  ]);
  let cBalEncrypted: string;
  try {
    cBalEncrypted = String(await cCaller.confidentialBalanceOf(args.owner));
  } catch {
    cBalEncrypted = String(await cRead.confidentialBalanceOf(args.owner));
  }

  let escrowOperatorEnabled = false;
  try {
    escrowOperatorEnabled = Boolean(await cRead.isOperator(args.owner, args.escrow));
  } catch {
    escrowOperatorEnabled = false;
  }

  return {
    underlyingBalance: ethers.formatUnits(uBal, Number(uDecimals)),
    confidentialBalance: "Encrypted",
    confidentialBalanceHandle: String(cBalEncrypted),
    underlyingAllowanceToWrapper: ethers.formatUnits(uAllowance, Number(uDecimals)),
    escrowOperatorEnabled,
  };
}

export async function getFundingContractsForPair(args: {
  pairKey: PairKey;
  side: Side;
}): Promise<{ cToken: string; underlyingToken: string }> {
  const provider = getRpcProvider();
  const escrow = getEscrowContract(args.pairKey, provider);
  // Funding token is what trader pays:
  // - Buy => pay quote token (A on this escrow deployment)
  // - Sell => pay base token (B on this escrow deployment)
  const cToken = args.side === "Buy" ? String(await escrow.cTokenA()) : String(await escrow.cTokenB());
  const wrapper = new ethers.Contract(cToken, WRAPPER_ABI, provider);
  const underlyingToken = String(await wrapper.underlying());
  return { cToken, underlyingToken };
}

export async function approveUnderlyingForWrapper(args: {
  underlyingToken: string;
  wrapperToken: string;
  amountHuman: string;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const erc20 = new ethers.Contract(args.underlyingToken, ERC20_ABI, signer);
  const decimals = Number(await erc20.decimals());
  const amount = ethers.parseUnits(args.amountHuman, decimals);
  const tx = await erc20.approve(args.wrapperToken, amount);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function findWrapperForUnderlying(underlyingToken: string): Promise<string> {
  const key = underlyingToken.toLowerCase();
  const cached = wrapperByUnderlyingCache.get(key);
  if (cached) return cached;

  const provider = getRpcProvider();
  const allWrappers = Object.values(CONTRACTS.wrappers);
  for (const wrapperAddr of allWrappers) {
    try {
      const wrapper = new ethers.Contract(wrapperAddr, WRAPPER_ABI, provider);
      const underlying = String(await wrapper.underlying()).toLowerCase();
      if (underlying === key) {
        wrapperByUnderlyingCache.set(key, wrapperAddr);
        return wrapperAddr;
      }
    } catch {
      // ignore non-wrapper entries or read failures
    }
  }
  throw new Error(`No wrapper found for underlying ${underlyingToken}`);
}

export async function wrapIntoConfidential(args: {
  wrapperToken: string;
  amountHuman: string;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const wrapper = new ethers.Contract(args.wrapperToken, WRAPPER_ABI, signer);
  const underlying = String(await wrapper.underlying());
  const u = new ethers.Contract(underlying, ERC20_ABI, signer);
  const decimals = Number(await u.decimals());
  const amount = ethers.parseUnits(args.amountHuman, decimals);
  const to = await signer.getAddress();
  const tx = await wrapper.wrap(to, amount);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function approveConfidentialForEscrow(args: {
  cToken: string;
  escrow: string;
  amountHuman: string;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const c = new ethers.Contract(args.cToken, WRAPPER_ABI, signer);
  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;
  const until = now + oneYear;
  const tx = await c.setOperator(args.escrow, until);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function fetchOrdersForAddress(address: string, pairKeys: PairKey[]): Promise<ChainOrder[]> {
  const provider = getRpcProvider();
  const normalized = address.toLowerCase();
  const byBlock = new Map<number, number>();
  const rows: ChainOrder[] = [];

  for (const pairKey of pairKeys) {
    const pair = CONTRACTS.pairs[pairKey];
    const pairLabel = pairKey.replace("_", "/");
    const escrow = getEscrowContract(pairKey, provider);

    const sellEvents = await queryFilterChunked(
      escrow,
      escrow.filters.SellOrderSubmitted(null, normalized),
      provider,
    );
    for (const e of sellEvents) {
      if (!e.args) continue;
      byBlock.set(e.blockNumber, 0);
      rows.push({
        orderId: e.args.orderId.toString(),
        pairKey,
        pairLabel,
        side: "Sell",
        trader: e.args.seller,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        status: "Pending",
      });
    }

    const buyEvents = await queryFilterChunked(
      escrow,
      escrow.filters.BuyOrderSubmitted(null, normalized),
      provider,
    );
    for (const e of buyEvents) {
      if (!e.args) continue;
      byBlock.set(e.blockNumber, 0);
      rows.push({
        orderId: e.args.orderId.toString(),
        pairKey,
        pairLabel,
        side: "Buy",
        trader: e.args.buyer,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        status: "Pending",
      });
    }

    const cancelEvents = await queryFilterChunked(
      escrow,
      escrow.filters.OrderCancelled(null, normalized),
      provider,
    );
    const cancelled = new Set(cancelEvents.map((e) => e.args?.orderId?.toString()).filter(Boolean));
    for (const row of rows) {
      if (row.pairKey === pairKey && cancelled.has(row.orderId)) row.status = "Cancelled";
    }
  }

  await Promise.all(
    Array.from(byBlock.keys()).map(async (bn) => {
      const block = await provider.getBlock(bn);
      byBlock.set(bn, Number(block?.timestamp ?? 0) * 1000);
    }),
  );

  for (const row of rows) row.timestamp = byBlock.get(row.blockNumber) ?? Date.now();
  return rows.sort((a, b) => b.blockNumber - a.blockNumber);
}

export async function fetchActivity(pairKeys: PairKey[]): Promise<ChainActivity[]> {
  const provider = getRpcProvider();
  const result: ChainActivity[] = [];
  const ts = new Map<number, number>();

  for (const pairKey of pairKeys) {
    const pairLabel = pairKey.replace("_", "/");
    const matcher = new ethers.Contract(CONTRACTS.pairs[pairKey].matcher, MATCHER_ABI, provider);

    const requested = await queryFilterChunked(
      matcher,
      matcher.filters.MatchRequested(),
      provider,
    );
    for (const e of requested) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-req-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: "MATCH_REQUESTED",
      });
    }

    const resolved = await queryFilterChunked(
      matcher,
      matcher.filters.MatchResolved(),
      provider,
    );
    for (const e of resolved) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-res-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: e.args?.matched ? "MATCHED" : "NO_MATCH",
      });
    }

    const partial = await queryFilterChunked(
      matcher,
      matcher.filters.PartialFill(),
      provider,
    );
    for (const e of partial) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-par-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: "PARTIAL_FILL",
      });
    }
  }

  await Promise.all(
    Array.from(ts.keys()).map(async (bn) => {
      const block = await provider.getBlock(bn);
      ts.set(bn, Number(block?.timestamp ?? 0) * 1000);
    }),
  );

  for (const row of result) row.timestamp = ts.get(row.blockNumber) ?? Date.now();
  return result.sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 100);
}
