import { JsonRpcProvider, Wallet, Contract, Interface, getAddress } from "ethers";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";

const MATCHER_ABI = [
  "function nextRequestId() view returns (uint256)",
  "function pendingMatches(uint256 requestId) view returns (uint256 sellOrderId, uint256 buyOrderId, address seller, address buyer, bytes32 priceMatchedHandle, bytes32 buyIsSmallerHandle, bytes32 fillSizeHandle, bytes32 sellRemainderHandle, bytes32 buyRemainderHandle, bool exists)",
  "function getPendingHandles(uint256 requestId) view returns (bytes32[] memory handles)",
  "function resolveMatchWithProof(uint256 requestId, bytes cleartexts, bytes decryptionProof)",
] as const;

type ResolveResult = {
  matcher: string;
  scannedRequestIds: number;
  resolved: number;
  skippedNotPending: number;
  failures: Array<{ requestId: string; error: string }>;
};

type ApiRequest = {
  headers: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => unknown };
};

const iface = new Interface(MATCHER_ABI);

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getProvider(): JsonRpcProvider {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.VITE_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL (or VITE_SEPOLIA_RPC_URL) is required");
  return new JsonRpcProvider(rpcUrl);
}

function getGatewayAddressFromEnv(): string {
  const gateway = process.env.GATEWAY_ADDRESS;
  if (!gateway) throw new Error("GATEWAY_ADDRESS is required");
  return getAddress(gateway);
}

function getMatcherAddressesFromEnv(): string[] {
  const csv = process.env.MATCHER_ADDRESSES;
  if (!csv) throw new Error("MATCHER_ADDRESSES is required (comma-separated matcher addresses)");
  return [
    ...new Set(
      csv
        .split(",")
        .map((s) => getAddress(s.trim()))
        .filter(Boolean),
    ),
  ];
}

async function resolveForMatcher(
  signer: Wallet,
  matcherAddress: string,
  relayer: Awaited<ReturnType<typeof createInstance>>,
): Promise<ResolveResult> {
  const matcher = new Contract(matcherAddress, MATCHER_ABI, signer);
  const nextRequestId = (await matcher.nextRequestId()) as bigint;
  const maxSweep = Number(process.env.MATCHER_MAX_REQUESTS_PER_MATCHER || 300);
  const latestRequestId = Number(nextRequestId > 0n ? nextRequestId - 1n : 0n);
  const oldestRequestId = Math.max(1, latestRequestId - maxSweep + 1);

  const result: ResolveResult = {
    matcher: matcherAddress,
    scannedRequestIds: 0,
    resolved: 0,
    skippedNotPending: 0,
    failures: [],
  };

  for (let requestIdNum = latestRequestId; requestIdNum >= oldestRequestId; requestIdNum--) {
    result.scannedRequestIds += 1;
    const requestId = BigInt(requestIdNum);

    try {
      const pending = await matcher.pendingMatches(requestId);
      if (!pending.exists) {
        result.skippedNotPending += 1;
        continue;
      }

      const handles = (await matcher.getPendingHandles(requestId)) as string[];
      const decryptRes = await relayer.publicDecrypt(handles);
      const tx = await matcher.resolveMatchWithProof(
        requestId,
        decryptRes.abiEncodedClearValues,
        decryptRes.decryptionProof,
      );
      await tx.wait(1);
      result.resolved += 1;
    } catch (err) {
      result.failures.push({
        requestId: requestId.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${secret}`) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    const provider = getProvider();
    const pk = getRequiredEnv("GATEWAY_PRIVATE_KEY");
    const signer = new Wallet(pk, provider);
    const expectedGateway = getGatewayAddressFromEnv();
    const signerAddress = getAddress(await signer.getAddress());
    if (signerAddress !== expectedGateway) {
      throw new Error(
        `GATEWAY_PRIVATE_KEY address ${signerAddress} != configured gateway ${expectedGateway}`,
      );
    }

    const latest = await provider.getBlockNumber();

    const networkUrl = getRequiredEnv("SEPOLIA_RPC_URL");
    const relayer = await createInstance({
      ...SepoliaConfig,
      network: networkUrl,
    });

    const matcherAddresses = getMatcherAddressesFromEnv();

    const summary: ResolveResult[] = [];
    for (const matcherAddress of matcherAddresses) {
      // Sequential execution avoids nonce races in cron runs.
      const r = await resolveForMatcher(signer, matcherAddress, relayer);
      summary.push(r);
    }

    return res.status(200).json({
      ok: true,
      network: "sepolia",
      latestBlock: latest,
      matcherCount: matcherAddresses.length,
      signer: signerAddress,
      summary,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
