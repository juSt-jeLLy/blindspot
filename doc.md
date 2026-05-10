# Blindspot Project Documentation

## 1. Project Summary

Blindspot is a confidential settlement engine for FX-style cross-border payment flows. It uses FHEVM so traders can submit encrypted rate and amount intent to an on-chain matching system. The chain can verify matching and settlement transitions without publishing the sensitive order values that normally let intermediaries infer flow size, direction, and urgency.

The project currently implements this as a confidential dark-pool DEX on Ethereum Sepolia. Conceptually, the same mechanism maps to corporate FX settlement:

- a buyer submits an encrypted bid rate and encrypted desired amount,
- a seller submits an encrypted ask/minimum rate and encrypted offered amount,
- the matcher compares encrypted rates,
- the matcher computes the executable encrypted fill size,
- settlement transfers confidential token balances,
- if one side is larger, the encrypted remainder is requeued for later matching.

The hardest part is partial-fill order-book logic under FHE. Blindspot already implements the core pattern: encrypted `select`, encrypted `sub`, proof-backed callback resolution, and requeueing of the encrypted remainder as a new order.

## 2. Domain Problem

Large cross-border payments and corporate FX orders are exposed to market structure leakage:

- visible order size can lead to worse pricing,
- visible limit rate or urgency can be used against the corporate,
- pre-trade visibility lets market makers adjust quotes before execution,
- fragmented partial fills reveal execution progress,
- public DeFi order books expose strategy to searchers and validators.

Blindspot focuses on the part that is most damaging to reveal: numeric execution intent. Addresses, timestamps, and pair IDs are still public because the system runs on a public chain, but rate, size, fill, and remainder arithmetic move into encrypted computation.

## 3. Confidentiality Model

### 3.1 Protected Values

The system protects:

- encrypted order rate/price,
- encrypted order size/amount,
- encrypted fill-size computation,
- encrypted remainder computation,
- confidential token balances,
- user balance decryption through wallet-authorized user decrypt.

### 3.2 Public Values

The system intentionally leaves these public:

- wallet addresses,
- contract addresses,
- token pair identity,
- order IDs,
- event timing,
- queue lifecycle events,
- final match/no-match resolution,
- proof-backed clear settlement-control values required to progress state.

### 3.3 Practical Privacy Boundary

Blindspot is not an anonymity system. It is an execution-confidentiality system. It reduces pre-trade and in-flight numeric leakage, but it does not hide network-level metadata, address linkage, or the fact that a wallet interacted with a given pair.

## 4. Current Implementation Status

The implementation uses:

- Solidity `0.8.27`,
- Zama FHEVM Solidity library,
- `@zama-fhe/relayer-sdk`,
- confidential ERC-20 wrapper contracts,
- Hardhat tests with the FHEVM plugin,
- React/TanStack frontend,
- Vercel API resolver for pending match callbacks.

Important implementation note: the contracts currently use `euint64` for encrypted price and size. The project thesis mentions `euint128 encryptedAmount`; that is the correct institutional direction for larger FX notionals, but the checked-in contracts currently operate on 64-bit encrypted integer handles.

## 5. Contract Architecture

### 5.1 `DarkPoolEscrow.sol`

Responsibilities:

- accepts encrypted buy and sell orders,
- verifies external encrypted inputs with `FHE.fromExternal`,
- stores orders and encrypted handles,
- maintains FIFO sell and buy queues,
- escrows confidential tokens,
- triggers matching when both sides have active orders,
- cancels open or partially filled orders,
- settles confidential token transfers,
- requeues encrypted partial-fill remainders.

Key state:

- `nextOrderId`,
- `matchInFlight`,
- `_sellQueue`,
- `_buyQueue`,
- `sellHead`,
- `buyHead`,
- `orders`.

Key methods:

- `submitSellOrder`,
- `submitBuyOrder`,
- `cancelOrder`,
- `consumeHeadOrders`,
- `fillBoth`,
- `fillBuyRequeueSell`,
- `fillSellRequeueBuy`,
- `settleTransfer`,
- `releaseMatchLockAndTryNext`.

### 5.2 `DarkPoolMatcher.sol`

Responsibilities:

- receives the active buy/sell pair from escrow,
- performs encrypted rate comparison,
- performs encrypted fill-size selection,
- computes encrypted buy and sell remainders,
- creates pending match requests,
- exposes ciphertext handles for resolver public decrypt,
- verifies resolver callback proofs,
- decides queue rotation or settlement,
- calls escrow to fill, requeue, or continue scanning.

Core encrypted operations:

```solidity
ebool priceMatched = FHE.ge(buyPrice, sellPrice);
ebool buyIsSmaller = FHE.le(buySize, sellSize);
euint64 fillSize = FHE.select(buyIsSmaller, buySize, sellSize);
euint64 sellRemainder = FHE.sub(sellSize, fillSize);
euint64 buyRemainder = FHE.sub(buySize, fillSize);
```

The user story describes `TFHE.eq(rate_buyer, rate_seller)`. The current matcher uses `FHE.ge(buyPrice, sellPrice)`, which is more suitable for a limit-order style market: a buyer willing to pay at least the seller's minimum rate can match. If exact-rate matching is required for a fixed corporate RFQ or payment rail, this comparison can be changed to equality.

### 5.3 `DarkPoolSettlement.sol`

Responsibilities:

- settlement abstraction for confidential transfer between seller and buyer,
- emits settlement event,
- restricts settlement calls to matcher.

In the current escrow flow, `DarkPoolEscrow.settleTransfer` performs the direct confidential transfer path used by the matcher.

### 5.4 `DarkPoolFactory.sol`

Responsibilities:

- deploys or reuses confidential token wrappers,
- creates pair-specific escrow, matcher, and settlement contracts,
- indexes pairs by ordered token hash,
- stores wrapper mappings by underlying token.

### 5.5 `DarkPoolToken.sol`

Responsibilities:

- confidential wrapper around an underlying token,
- supports wrapping and unwrapping into confidential balances,
- integrates with ERC-7984-style confidential transfer paths.

## 6. Order Lifecycle

### 6.1 Funding

For a buy order, the user funds with the quote asset. For a sell order, the user funds with the base asset.

Frontend sequence:

1. approve underlying token to wrapper,
2. wrap underlying into confidential token,
3. approve escrow/operator path for confidential token,
4. decrypt local confidential balance handle when the user authorizes it.

### 6.2 Submission

The frontend encrypts the numeric order fields with the Zama relayer SDK:

```ts
const input = relayer.createEncryptedInput(contractAddress, userAddress);
input.add64(price);
input.add64(size);
const encrypted = await input.encrypt();
```

The escrow accepts:

- encrypted price handle,
- price proof,
- encrypted size handle,
- size proof.

It converts external encrypted values to FHEVM internal handles and stores the order.

### 6.3 Match Trigger

Escrow calls `_triggerMatchIfReady` after order submission or resolver release. If both queues have active heads and no match is in flight, it calls:

```solidity
matcher.onOrdersReady(
    sellId,
    buyId,
    sellOrder.encPrice,
    buyOrder.encPrice,
    sellOrder.encSize,
    buyOrder.encSize
);
```

### 6.4 Pending Match Request

The matcher computes encrypted results and stores handles in `pendingMatches`.

Stored handles:

- `priceMatchedHandle`,
- `buyIsSmallerHandle`,
- `fillSizeHandle`,
- `sellRemainderHandle`,
- `buyRemainderHandle`.

These handles are made publicly decryptable so the resolver can obtain proof-backed clear values needed to progress the state machine.

### 6.5 Resolver Callback

`api/resolve-matches.ts`:

1. reads matcher addresses from `MATCHER_ADDRESSES`,
2. scans recent request IDs,
3. checks `pendingMatches`,
4. calls `getPendingHandles`,
5. calls relayer `publicDecrypt(handles)`,
6. submits `resolveMatchWithProof(requestId, cleartexts, proof)`,
7. waits for confirmation.

The matcher verifies:

```solidity
FHE.checkSignatures(handles, cleartexts, decryptionProof);
```

This binds the clear result to the ciphertext handles and the KMS proof.

## 7. Partial-Fill Mechanics

Partial fills are handled by comparing encrypted sizes and requeueing encrypted remainders.

### 7.1 Buyer Smaller

Example:

- seller offers 10,
- buyer wants 6,
- fill size is 6,
- seller remainder is 4.

State transition:

- original sell order becomes `PartiallyFilled`,
- buy order becomes `Filled`,
- new sell order is created with encrypted `sellRemainder`,
- new sell order replaces the current sell queue head,
- buy queue advances.

Code path:

```solidity
fillBuyRequeueSell(sellOrderId, buyOrderId, sellRemainder)
```

### 7.2 Seller Smaller

Example:

- seller offers 6,
- buyer wants 10,
- fill size is 6,
- buyer remainder is 4.

State transition:

- sell order becomes `Filled`,
- original buy order becomes `PartiallyFilled`,
- new buy order is created with encrypted `buyRemainder`,
- new buy order replaces the current buy queue head,
- sell queue advances.

Code path:

```solidity
fillSellRequeueBuy(sellOrderId, buyOrderId, buyRemainder)
```

### 7.3 Full Fill

If neither side has a positive remainder:

- both orders become `Filled`,
- both queue heads advance.

Code path:

```solidity
fillBoth(sellOrderId, buyOrderId)
```

### 7.4 No Match

If rates do not cross:

- both orders remain open,
- the matcher rotates the buy head to scan alternative counterparties,
- after scanning available buy orders, it rotates the sell head,
- the match lock is released and the next attempt begins.

This prevents a single non-crossing pair from permanently blocking the queue.

## 8. Frontend Architecture

Main routes:

- `src/routes/index.tsx` landing/dashboard,
- `src/routes/trade.tsx` encrypted order entry and funding,
- `src/routes/orders.tsx` order monitoring and cancellation,
- `src/routes/pools.tsx` pair/pool display,
- `src/routes/activity.tsx` activity feed,
- `src/routes/profile.tsx` confidential balance decrypt and unwrap.

Important libraries:

- `src/lib/fhe.ts` for encryption/decryption helpers,
- `src/lib/web3.ts` for wallet and contract calls,
- `src/lib/contracts-config.ts` for Sepolia addresses,
- `src/lib/live-pairs.ts` for pair metadata.

The UI intentionally shows public metadata and funding status but does not decode order price/size unless the user authorizes a decrypt flow for handles they are allowed to read.

## 9. API Resolver Architecture

The resolver is separate from the frontend because it holds privileged gateway credentials.

Endpoint:

```text
GET /api/resolve-matches
```

Security:

- optional bearer auth through `CRON_SECRET`,
- `GATEWAY_PRIVATE_KEY` must resolve to `GATEWAY_ADDRESS`,
- matcher callback is restricted by `onlyGateway`,
- callbacks verify KMS signatures with `FHE.checkSignatures`.

Operational controls:

- `MATCHER_ADDRESSES` controls which matchers are swept,
- `MATCHER_MAX_REQUESTS_PER_MATCHER` limits scan range,
- resolver processes matchers sequentially to avoid nonce races.

## 10. Deployment Model

Recommended split:

- frontend deployment: UI only, no gateway private key,
- API deployment: resolver endpoint and gateway secrets,
- contracts deployment: pair factory plus pair-specific escrow/matcher/settlement contracts.

Frontend environment:

- Sepolia RPC URL if needed for relayer/browser fallback,
- optional Zama API key,
- public contract addresses through checked-in config or deployment injection.

API environment:

- `CRON_SECRET`,
- `SEPOLIA_RPC_URL`,
- `GATEWAY_PRIVATE_KEY`,
- `GATEWAY_ADDRESS`,
- `MATCHER_ADDRESSES`,
- `MATCHER_MAX_REQUESTS_PER_MATCHER` optional.

## 11. Local Commands

Frontend:

```bash
npm install
npm run dev
npm run build
```

Contracts:

```bash
cd contracts
npm install
npm run build
npm test
```

Deploy contracts:

```bash
cd contracts
OWNER_ADDRESS=0x... GATEWAY_ADDRESS=0x... npm run deploy:local
SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=... OWNER_ADDRESS=0x... GATEWAY_ADDRESS=0x... npm run deploy:sepolia
```

## 12. Tests

The integration test suite covers:

- full fill,
- seller remainder partial fill,
- no-match queue rotation,
- rejection of non-gateway resolver callbacks.

Main test file:

```text
contracts/test/matcher.integration.spec.ts
```

Recommended additional tests:

- buyer remainder partial fill across multiple subsequent matches,
- chained partial fills over three or more counterparties,
- cancellation after partial fill,
- queue rotation invariants with several non-crossing orders,
- proof mismatch rejection,
- confidential balance conservation across fill/requeue/cancel flows.

## 13. Security and Risk Notes

### 13.1 Gateway Trust and Availability

The resolver can only progress matches when it can obtain public decrypt results and submit the proof callback. If the resolver is offline, orders remain pending until resolution resumes.

### 13.2 Metadata Leakage

Public chains still reveal interaction timing, pair selection, and wallet addresses. Blindspot protects numeric intent, not all metadata.

### 13.3 Public Decrypt of Match-Control Values

The current design publicly decrypts match-control values after encrypted computation. This is required for the on-chain state machine to branch and settle. It means observers can learn the final match decision and fill-control results for a match request, but not the original encrypted inputs before execution.

### 13.4 Numeric Range

The current implementation uses `euint64` scaled to 6 decimals in the frontend. For institutional FX amounts, `euint128` should be considered for amount fields.

### 13.5 Price Model

The current matcher uses `buyPrice >= sellPrice`, not exact equality. This supports limit-order matching. Exact rate matching for fixed-rate settlement can be implemented by replacing the comparison with equality and updating tests/docs accordingly.

## 14. Future Work

High-impact improvements:

- migrate encrypted amount from `euint64` to `euint128`,
- add explicit FX/corporate payment pair model,
- add settlement currency and delivery-window metadata,
- add order expiry,
- support batch resolution,
- improve resolver observability,
- strengthen multi-round invariant tests,
- formalize balance conservation properties,
- add deployment documentation for production-grade key management,
- add compliance-aware participant onboarding hooks if this becomes a regulated payment rail.

## 15. Mental Model

Blindspot turns an order book into a confidential state machine:

```text
encrypted intent -> encrypted comparison -> encrypted fill math -> proof-backed branch -> confidential settlement -> encrypted remainder requeue
```

That final step is the key distinction. Without encrypted remainders, FHE matching is only a private one-shot comparison. With encrypted remainders, the system starts to behave like a real confidential order book for multi-round institutional settlement.
