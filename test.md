# FHE Dark Liquidity Pool — Complete Project Specification

> **Project Codename:** `shadowpool`
> **Chain:** Ethereum Sepolia Testnet
> **Stack:** Zama FHEVM · `@fhevm/solidity` v0.11.1 · `fhevm-contracts` v0.2.4 · Hardhat · React · `@zama-fhe/relayer-sdk`
> **Standard:** ERC-7984 (Confidential Token Draft)
> **Version:** 1.0.0
> **Last Updated:** 2026-05-07

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [What We're Building](#3-what-were-building)
4. [Architecture Overview](#4-architecture-overview)
5. [Cryptographic Primitives](#5-cryptographic-primitives)
6. [Smart Contract System](#6-smart-contract-system)
   - 6.1 [DarkPoolToken.sol](#61-darkpooltokensol)
   - 6.2 [DarkPoolEscrow.sol](#62-darkpoolescrowsol)
   - 6.3 [DarkPoolMatcher.sol](#63-darkpoolmatchersol)
   - 6.4 [DarkPoolSettlement.sol](#64-darkpoolsettlementsol)
7. [Order Lifecycle](#7-order-lifecycle)
8. [Partial Fill Logic](#8-partial-fill-logic)
9. [Gateway Callback Chain](#9-gateway-callback-chain)
10. [Access Control Model](#10-access-control-model)
11. [Token Decimal Design](#11-token-decimal-design)
12. [Frontend Architecture](#12-frontend-architecture)
13. [Security Model](#13-security-model)
14. [Gas Analysis](#14-gas-analysis)
15. [Testing Strategy](#15-testing-strategy)
16. [Deployment Plan](#16-deployment-plan)
17. [Known Constraints & Limitations](#17-known-constraints--limitations)
18. [What This Is Not](#18-what-this-is-not)
19. [Future Roadmap](#19-future-roadmap)
20. [Glossary](#20-glossary)
21. [Multi-Token Factory Extension](#21-multi-token-factory-extension)

---

## 1. Executive Summary

**ShadowPool** is the first true dark pool on any public blockchain. It enables institutional-scale token block trades where order size, price, and counterparty identity remain fully encrypted throughout the entire matching lifecycle — including during on-chain computation.

Unlike existing "privacy DEXs" that use ZK proofs to hide amounts *after* execution, or AMMs that hide nothing at all, ShadowPool uses Fully Homomorphic Encryption (FHE) via Zama's FHEVM coprocessor so that the matching engine itself operates on ciphertext. The blockchain never sees a plaintext price or size. Only the binary outcome — `MATCHED` or `NO MATCH` — is public.

This is built on Sepolia testnet using the `@fhevm/solidity` standalone library and `fhevm-contracts` v0.2.4, with ERC-7984 confidential token wrappers for both sides of the trade pair.

---

## 2. Problem Statement

### The Institutional Block Trade Problem

When a pension fund, hedge fund, or treasury desk needs to liquidate a large position — say $200M of a token — no existing onchain venue can serve them safely:

| Venue | Problem |
|---|---|
| Uniswap / any AMM | Order size is public before execution. Front-runners see the incoming $200M and drain liquidity. Price impact is catastrophic. |
| 1inch / aggregators | Routes are visible in the mempool. MEV bots front-run across all routes simultaneously. |
| Orderbook DEXs (dYdX, etc.) | Limit orders are public. Large visible asks collapse the market before they fill. |
| OTC desks | Requires trust in a centralized counterparty. Counterparty credit risk. No settlement guarantee. |

### How TradFi Solves It

Traditional finance solved this in the 1990s with **dark pools** — private electronic trading venues where:
- Orders are submitted privately and never shown to the public order book
- Matching happens internally between consenting counterparties
- Only the post-trade report (price + size) is disclosed, and only to regulators

Today, roughly 13–18% of all US equity volume flows through dark pools (NYSE Arcabook, Goldman Sachs Sigma X, Morgan Stanley MS Pool, etc.).

### Why Blockchain Dark Pools Have Failed

Every previous attempt at a "dark pool" on blockchain has failed the same way: the EVM is transparent. Even if you encrypt inputs, the contract must eventually decrypt them to compare. The moment the matching engine runs, prices and sizes are visible to block producers.

**ZK proofs prove correctness of a computation but reveal the inputs to the prover.** A ZK dark pool requires a trusted matching operator who sees all orders in plaintext — defeating the purpose.

### What FHE Changes

FHE allows computation *directly on ciphertext*. `TFHE.ge(encBid, encAsk)` returns an encrypted boolean — `ebool` — without ever decrypting either value. The coprocessor computes the result off-chain on ciphertext, posts the encrypted result on-chain, and only the gateway decryption reveals the match outcome (matched/not matched) — not the inputs.

This is the only cryptographic primitive that enables a genuine dark pool on a public blockchain.

---

## 3. What We're Building

### Scope: Single-Pair Sealed-Bid Dark Pool

**Token Pair:** `cETH / cUSDT` (Confidential ETH wrapper and Confidential USDT wrapper, both ERC-7984)

**Pool Model:** Single active order per side. Sellers post asks. Buyers post bids. One-to-one matching. Partial fills supported.

**What stays private (forever):**
- Seller's minimum acceptable price (`encMinPrice: euint64`)
- Buyer's maximum bid price (`encBidPrice: euint64`)
- Seller's order size (`encSellSize: euint64`)
- Buyer's order size (`encBuySize: euint64`)
- Which side submitted first
- The identities of counterparties (to each other — not to themselves)

**What is public:**
- That an order exists (a slot is occupied — binary flag only)
- Match outcome: `MATCHED` or `NO_MATCH` event
- Post-settlement token transfer events (required by ERC-20 spec, amounts omitted per ERC-7984)
- Timestamps of order submission and settlement
- Contract addresses and order IDs

**What partial fills reveal (deliberately):**
- Nothing additional. Partial fill remainder is requeued as a new encrypted order with a new `orderId`. The `PARTIAL_FILL` event contains only: `orderId`, `timestamp`, `remainderOrderId`. No amounts.

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                         │
│  fhevmjs client-side encryption  │  @zama-fhe/relayer-sdk      │
│  Trader UI (Institutional)       │  Order Status Poller         │
└────────────────────┬────────────────────────────────────────────┘
                     │ encrypted inputs + ZK input proofs
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DarkPoolEscrow.sol                           │
│  - Accepts encrypted order parameters                           │
│  - Calls confidentialTransferFrom (ERC-7984) to lock tokens     │
│  - Assigns orderId, stores encrypted state                      │
│  - Triggers Gateway comparison request                          │
└────────────────────┬────────────────────────────────────────────┘
                     │ TFHE.ge(bid, ask) / TFHE.le(buySize, sellSize)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ZAMA FHE COPROCESSOR                          │
│  Off-chain FHE computation on ciphertext handles                │
│  Returns encrypted results (ebool) to Gateway                   │
└────────────────────┬────────────────────────────────────────────┘
                     │ Gateway callback (async, ~2-5s on Sepolia)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DarkPoolMatcher.sol                            │
│  - Gateway callback handler                                     │
│  - Receives ebool results                                       │
│  - Routes to settlement or refund                               │
│  - Handles partial fill state machine                           │
└────────────────────┬────────────────────────────────────────────┘
                     │ confidentialTransfer (ERC-7984)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                 DarkPoolSettlement.sol                          │
│  - Executes token swaps between matched counterparties          │
│  - Uses TFHE.select() for conditional transfer amounts          │
│  - Emits SETTLED / NO_MATCH / PARTIAL_FILL events               │
└─────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────┐
│       DarkPoolToken.sol (x2)     │
│  cETH — ERC-7984 Confidential   │
│  cUSDT — ERC-7984 Confidential  │
│  ConfidentialERC20Wrapped base   │
└──────────────────────────────────┘
```

### Component Responsibility Summary

| Contract | Responsibility | FHE Operations |
|---|---|---|
| `DarkPoolToken` | ERC-7984 confidential token wrapper | None (delegates to base) |
| `DarkPoolEscrow` | Order intake + token locking + Gateway dispatch | `TFHE.asEuint64()` input verification |
| `DarkPoolMatcher` | Gateway callback handling + state machine | `TFHE.ge()`, `TFHE.le()`, `TFHE.sub()`, `TFHE.select()` |
| `DarkPoolSettlement` | Final token swap execution | `TFHE.select()` conditional transfer |

---

## 5. Cryptographic Primitives

### 5.1 FHEVM Type System

All order parameters are stored as encrypted 64-bit unsigned integers:

```solidity
euint64 encMinPrice;    // Seller: minimum price willing to accept (per unit, in USDT with 6 decimals)
euint64 encBidPrice;    // Buyer: maximum price willing to pay (per unit, in USDT with 6 decimals)
euint64 encSellSize;    // Seller: total token quantity offered (in cETH with 6 decimals)
euint64 encBuySize;     // Buyer: total token quantity demanded (in cETH with 6 decimals)
ebool   priceMatched;   // Result of TFHE.ge(encBidPrice, encMinPrice)
ebool   sizeComparison; // Result of TFHE.le(encBuySize, encSellSize)
euint64 fillSize;       // TFHE.select(sizeComparison, encBuySize, encSellSize)
euint64 remainder;      // TFHE.sub(largerSize, fillSize)
```

### 5.2 Why `euint64` is Sufficient

`euint64` max value: `2^64 - 1 = 18,446,744,073,709,551,615`

With 6 decimal places (matching `ConfidentialERC20` default):
- Max representable amount: `18,446,744,073,709.551615` tokens
- At $1/token: **$18.4 trillion maximum order size**
- Institutional block trade ($200M): `200,000,000 × 10^6 = 200,000,000,000,000` units — well within range

`euint128` is available in FHEVM (`2^128 - 1`) and supported for all arithmetic and comparison ops, but is not needed for this use case and adds gas overhead.

### 5.3 Core FHE Operations Used

#### Price Matching
```solidity
// Does the buyer's bid meet the seller's minimum?
ebool priceMatched = TFHE.ge(encBidPrice, encMinPrice);
TFHE.allowThis(priceMatched);
```

#### Size Comparison (for partial fill determination)
```solidity
// Is the buy order smaller than or equal to the sell order?
ebool buyIsSmaller = TFHE.le(encBuySize, encSellSize);
TFHE.allowThis(buyIsSmaller);
```

#### Fill Size Calculation
```solidity
// Fill size = min(buySize, sellSize)
euint64 fillSize = TFHE.select(buyIsSmaller, encBuySize, encSellSize);
TFHE.allowThis(fillSize);
// allow both counterparties to decrypt their own fill confirmation
TFHE.allow(fillSize, sellerAddress);
TFHE.allow(fillSize, buyerAddress);
```

#### Remainder for Partial Fill
```solidity
// Remainder = largerSize - fillSize
euint64 remainder = TFHE.select(
    buyIsSmaller,
    TFHE.sub(encSellSize, fillSize),   // seller had more: seller remainder
    TFHE.sub(encBuySize, fillSize)     // buyer had more: buyer remainder
);
TFHE.allowThis(remainder);
```

#### Safe Subtraction Guard (Critical — prevents silent overflow)
```solidity
// Before any subtraction, always verify direction first
// TFHE arithmetic is unchecked — overflow wraps silently
// This is guaranteed safe because fillSize = min(buySize, sellSize)
// so subtraction result is always >= 0
```

### 5.4 Input Proof Verification

All encrypted inputs from users must include a ZK input proof generated client-side:

```solidity
// In DarkPoolEscrow.sol
function submitSellOrder(
    externalEuint64 encMinPrice,
    bytes calldata priceProof,
    externalEuint64 encSellSize,
    bytes calldata sizeProof
) external {
    euint64 minPrice = FHE.fromExternal(encMinPrice, priceProof);
    euint64 sellSize = FHE.fromExternal(encSellSize, sizeProof);
    // Store verified encrypted values...
}
```

The input proof guarantees:
1. The encrypted value was created by the sender (not replayed from another user)
2. The encrypted value is a valid TFHE ciphertext (not malformed)
3. The sender knows the plaintext (prevents ciphertext replay attacks)

---

## 6. Smart Contract System

### 6.1 `DarkPoolToken.sol`

**Purpose:** ERC-7984 confidential token wrapper for both sides of the pair.

**Deployed twice:** once as `cETH`, once as `cUSDT`.

**Base contract:** `ConfidentialERC20Wrapped` from `fhevm-contracts` v0.2.4

**Key design decisions:**
- Source ERC-20 must have `decimals() >= 6` (Zama requirement for `ConfidentialERC20Wrapped`)
- `decimals()` returns `6` (default from `ConfidentialERC20` base — not 18)
- `totalSupply` is plaintext `uint64` — must be manually updated after every `_unsafeMint` / `_unsafeBurn`
- Transfer events emit `type(uint256).max` as placeholder amount (ERC-7984 spec — hides amounts)
- `maxDecryptionDelay` set to `1 days` (max allowed by `ConfidentialERC20Wrapped`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SepoliaZamaFHEVMConfig } from "fhevm/config/ZamaFHEVMConfig.sol";
import { ConfidentialERC20Wrapped } from "fhevm-contracts/contracts/token/ERC20/extensions/ConfidentialERC20Wrapped.sol";

contract DarkPoolToken is SepoliaZamaFHEVMConfig, ConfidentialERC20Wrapped {
    constructor(
        address underlyingToken,
        string memory name,
        string memory symbol
    ) ConfidentialERC20Wrapped(underlyingToken, name, symbol, 1 days) {}
}
```

**Critical notes:**
- Use `TFHE` namespace (not `FHE`) in any overrides — `fhevm-contracts` uses `TFHE`
- The override point for transfer logic is `_transferNoEvent` — NOT `_update`
- `isAccountRestricted(account)` returns `true` during a pending unwrap for that account — blocks movement

---

### 6.2 `DarkPoolEscrow.sol`

**Purpose:** Order intake, token locking, order book management, Gateway dispatch.

**Namespace:** `TFHE` (since we extend `fhevm-contracts` base)

**State:**

```solidity
struct Order {
    address trader;
    euint64 encPrice;       // min ask (seller) or max bid (buyer)
    euint64 encSize;        // token quantity
    OrderSide side;         // BUY or SELL
    OrderStatus status;     // Open, Locked, PartiallyFilled, Filled, Cancelled
    uint256 timestamp;
    uint256 orderId;
    uint256 parentOrderId;  // for remainder orders from partial fills
}

enum OrderSide { BUY, SELL }

enum OrderStatus { 
    Open,           // Accepting match attempts
    Locked,         // Match in progress (Gateway callback pending)
    PartiallyFilled,// Part filled, remainder requeued
    Filled,         // Fully consumed
    Cancelled       // Refunded
}

mapping(uint256 => Order) public orders;
uint256 public activeSellOrderId;   // Only one active per side
uint256 public activeBuyOrderId;
uint256 public nextOrderId;
```

**Core functions:**

```solidity
// Seller submits: encrypted min price + encrypted size
// Tokens locked via confidentialTransferFrom
function submitSellOrder(
    externalEuint64 encMinPrice,
    bytes calldata priceProof,
    externalEuint64 encSellSize,
    bytes calldata sizeProof
) external returns (uint256 orderId);

// Buyer submits: encrypted bid price + encrypted size
// Tokens locked via confidentialTransferFrom
function submitBuyOrder(
    externalEuint64 encBidPrice,
    bytes calldata priceProof,
    externalEuint64 encBuySize,
    bytes calldata sizeProof
) external returns (uint256 orderId);

// Called internally when both sides have active orders
// Locks both orders, requests Gateway comparison
function _triggerMatchAttempt(uint256 sellId, uint256 buyId) internal;

// Cancel own open order (only if status == Open)
function cancelOrder(uint256 orderId) external;
```

**Matching trigger logic:**
- When a new order arrives and the opposite side already has an `Open` order → `_triggerMatchAttempt` fires immediately
- If no opposite order exists → order sits as `Open` and waits
- Multiple orders queue is out of scope for v1 (one active slot per side)

**Token locking:**
```solidity
// For sell orders: lock cETH from seller
cETH.confidentialTransferFrom(msg.sender, address(this), encSellSize);
TFHE.allowThis(encSellSize);

// For buy orders: lock cUSDT from buyer  
// Amount locked = encBuySize * encBidPrice (worst-case escrow)
// Note: price * size multiplication in FHE is expensive — 
// v1 locks full notional at bid price, refunds remainder post-match
euint64 notional = TFHE.mul(encBuySize, encBidPrice); // ~300k gas
TFHE.allowThis(notional);
cUSDT.confidentialTransferFrom(msg.sender, address(this), notional);
```

**ACL rules (mandatory after every state mutation):**
```solidity
// After storing any encrypted value, always:
TFHE.allowThis(encValue);           // contract can use it in future ops
TFHE.allow(encValue, trader);       // trader can decrypt their own value
// If settlement contract needs access:
TFHE.allow(encValue, settlementContract);
```

---

### 6.3 `DarkPoolMatcher.sol`

**Purpose:** Gateway callback handler and partial fill state machine.

**This is the most complex contract in the system.**

**Inherits:** `GatewayCaller` from `fhevm/gateway/GatewayCaller.sol`

**Gateway callback registration:**

Each comparison request registers a callback function. The Gateway calls it when the FHE coprocessor has computed the result.

```solidity
// Request 1: price check
uint256 requestId = Gateway.requestDecryption(
    [TFHE.unwrap(priceMatched)],          // ciphertext handle to decrypt
    this.priceCheckCallback.selector,      // callback function
    0,                                     // msg.value for callback
    block.timestamp + 100,                 // deadline
    false                                  // not trustless
);
pendingRequests[requestId] = MatchContext({sellId: sellId, buyId: buyId, stage: Stage.PriceCheck});
```

**State machine stages:**

```
Stage 0: IDLE
    ↓ (both orders active → _triggerMatchAttempt)
Stage 1: PRICE_CHECK
    → Gateway: TFHE.ge(encBidPrice, encMinPrice) → ebool
    ↓ (callback: priceCheckCallback)
        If false → REFUND both, back to IDLE
        If true  → advance to SIZE_COMPARE
Stage 2: SIZE_COMPARE  
    → Gateway: TFHE.le(encBuySize, encSellSize) → ebool
    ↓ (callback: sizeCompareCallback)
        → advance to FILL_CALC regardless (we need to know direction)
Stage 3: FILL_CALC
    → Compute fillSize = TFHE.select(buyIsSmaller, encBuySize, encSellSize)
    → Compute remainder = TFHE.select(buyIsSmaller, 
          TFHE.sub(encSellSize, encBuySize),
          TFHE.sub(encBuySize, encSellSize))
    → No Gateway callback needed — TFHE.select is synchronous
    → Call DarkPoolSettlement.settle(sellId, buyId, fillSize)
    → If remainder > 0 (check with TFHE.gt(remainder, TFHE.asEuint64(0)) — needs callback):
        → advance to REMAINDER_CHECK
Stage 4: REMAINDER_CHECK (conditional)
    → Gateway: TFHE.gt(remainder, 0) → ebool
    ↓ (callback: remainderCheckCallback)
        If false → both orders fully filled, IDLE
        If true  → requeue remainder as new Open order for the larger side
```

**Full callback signatures:**
```solidity
function priceCheckCallback(
    uint256 requestId, 
    bool priceMatched    // decrypted ebool result
) external onlyGateway;

function sizeCompareCallback(
    uint256 requestId,
    bool buyIsSmaller    // decrypted ebool result
) external onlyGateway;

function remainderCheckCallback(
    uint256 requestId,
    bool hasRemainder    // decrypted ebool result
) external onlyGateway;
```

**Re-entrancy guard on locked orders:**
```solidity
modifier orderNotLocked(uint256 orderId) {
    require(orders[orderId].status != OrderStatus.Locked, "Order locked: callback pending");
    _;
}
```

No new match attempt can be triggered on a `Locked` order. This prevents a second buyer from racing the Gateway callback.

---

### 6.4 `DarkPoolSettlement.sol`

**Purpose:** Atomic token swap execution between matched counterparties.

Called only by `DarkPoolMatcher` after price match confirmed.

```solidity
function settle(
    uint256 sellOrderId,
    uint256 buyOrderId,
    euint64 fillSize,           // encrypted fill quantity (cETH units)
    euint64 fillPrice,          // encrypted execution price (cUSDT per unit)
    address seller,
    address buyer
) external onlyMatcher {
    // Compute payment = fillSize * fillPrice (encrypted multiplication)
    euint64 payment = TFHE.mul(fillSize, fillPrice);
    TFHE.allowThis(payment);
    TFHE.allow(payment, seller);
    TFHE.allow(payment, buyer);

    // Transfer cETH to buyer (fill size)
    // TFHE.select: if fillSize > 0 → transfer fillSize, else transfer 0
    ebool hasFill = TFHE.gt(fillSize, TFHE.asEuint64(0));
    euint64 ethToTransfer = TFHE.select(hasFill, fillSize, TFHE.asEuint64(0));
    cETH.confidentialTransfer(buyer, ethToTransfer);

    // Transfer cUSDT to seller (payment)
    euint64 usdtToTransfer = TFHE.select(hasFill, payment, TFHE.asEuint64(0));
    cUSDT.confidentialTransfer(seller, usdtToTransfer);

    // Refund excess USDT to buyer (escrowed notional - actual payment)
    // excess = escrowedNotional - payment
    euint64 excess = TFHE.sub(escrowedNotional[buyOrderId], payment);
    euint64 hasExcess = TFHE.gt(excess, TFHE.asEuint64(0));
    euint64 refund = TFHE.select(hasExcess, excess, TFHE.asEuint64(0));
    cUSDT.confidentialTransfer(buyer, refund);

    emit Settled(sellOrderId, buyOrderId, block.timestamp);
}
```

**No plaintext amounts in any event.** `Settled` event contains only order IDs and timestamp.

---

## 7. Order Lifecycle

### Full lifecycle — both orders match completely

```
T=0:  Seller calls submitSellOrder(encMinPrice, encSellSize)
      → cETH locked in escrow
      → Order{id=1, status=Open, side=SELL} created
      → No buyer yet → waits

T=1:  Buyer calls submitBuyOrder(encBidPrice, encBuySize)
      → cUSDT locked in escrow (worst-case notional)
      → Order{id=2, status=Open, side=BUY} created
      → Both sides active → _triggerMatchAttempt(1, 2) fires
      → Both orders → status=Locked
      → Gateway.requestDecryption(priceMatched) called

T=3:  [~2-5s later] priceCheckCallback fires
      → priceMatched = true
      → Gateway.requestDecryption(buyIsSmaller) called

T=6:  [~2-5s later] sizeCompareCallback fires
      → buyIsSmaller = true (buyer wants less than seller offers)
      → fillSize = encBuySize (synchronous TFHE.select)
      → remainder = TFHE.sub(encSellSize, encBuySize)
      → Gateway.requestDecryption(hasRemainder) called
      → DarkPoolSettlement.settle() called

T=8:  [~2-5s later] remainderCheckCallback fires
      → hasRemainder = true
      → New Order{id=3, status=Open, side=SELL, size=remainder} created
      → Seller's original order → status=PartiallyFilled
      → Buyer's order → status=Filled
      
T=9:  PARTIAL_FILL event emitted: {sellOrderId=1, buyOrderId=2, remainderOrderId=3}
      SETTLED event emitted: {sellOrderId=1, buyOrderId=2, timestamp}
```

### Order cancellation path

```
Trader calls cancelOrder(orderId)
  → Requires status == Open (not Locked, not Filled)
  → Unlocks tokens via confidentialTransfer back to trader
  → Order status → Cancelled
  → activeSellOrderId (or activeBuyOrderId) cleared to 0
```

---

## 8. Partial Fill Logic

### The Problem

Institutional orders are rarely equal in size. A seller offering 10,000 ETH may match with a buyer wanting only 3,000 ETH. In TradFi dark pools, partial fills are the norm.

### Implementation

**Step 1 — Determine fill size (synchronous):**
```solidity
// min(sellSize, buySize) — the amount both sides actually transact
euint64 fillSize = TFHE.select(buyIsSmaller, encBuySize, encSellSize);
```

**Step 2 — Compute remainder (synchronous):**
```solidity
// Which side has leftover?
euint64 sellerRemainder = TFHE.sub(encSellSize, fillSize);
euint64 buyerRemainder  = TFHE.sub(encBuySize, fillSize);
// The correct remainder (one of these will be zero)
euint64 remainder = TFHE.select(buyIsSmaller, sellerRemainder, buyerRemainder);
```

**Step 3 — Check if remainder is non-zero (async Gateway):**
```solidity
ebool hasRemainder = TFHE.gt(remainder, TFHE.asEuint64(0));
// Gateway callback needed to know whether to requeue
```

**Step 4 — Requeue (in callback):**
```solidity
// In remainderCheckCallback:
if (hasRemainder) {
    address remainderOwner = buyIsSmaller ? seller : buyer;
    euint64 remainderPrice = buyIsSmaller ? encMinPrice : encBidPrice;
    _requeueOrder(remainderOwner, remainderPrice, remainder, originalSide, parentOrderId);
}
```

**Step 5 — Requeued order:**
The remainder is stored as a brand new `Order` with:
- `parentOrderId` pointing to the original order
- `status = Open`
- Same encrypted price as the original
- New `orderId`

The trader whose order was partially filled sees their original order move to `PartiallyFilled` status and a new `Open` order appear with the remainder.

### Why Overflow is Impossible Here

```
fillSize = min(sellSize, buySize)
sellerRemainder = sellSize - fillSize 
                = sellSize - min(sellSize, buySize)
                ≥ 0 always (since fillSize ≤ sellSize)
```

The `TFHE.select` pattern guarantees we only subtract the smaller from the larger. Since `fillSize = min(a, b)`, both `a - fillSize` and `b - fillSize` are non-negative. FHE arithmetic is unchecked (wraps on overflow), so this guarantee must be enforced logically before the subtraction — which it is here.

---

## 9. Gateway Callback Chain

### What the Gateway Is

The Zama FHE Coprocessor is an off-chain service that performs the actual FHE computation. On Sepolia testnet, it monitors the chain for `RequestDecryption` events, computes the result on ciphertext, and calls back the registered function with the decrypted result.

**Sepolia Gateway contract address:** `0xc8c9303Cd7F337fab769686B593B87DC3403E0ce`

### Round-Trip Latency

On Sepolia testnet: **~2–5 seconds per callback**

For a full partial fill cycle (3 callbacks): **~6–15 seconds end-to-end**

This is demo-appropriate. For mainnet, Zama's roadmap targets sub-second callback latency using dedicated ASIC hardware.

### Callback Security

The `onlyGateway` modifier on all callback functions ensures only the Zama Gateway contract can call them. This prevents:
- External callers spoofing match outcomes
- Replay attacks from old callback results
- Frontrunning the callback with a manual call

```solidity
modifier onlyGateway() {
    require(
        msg.sender == GatewayContractAddress,
        "Only Zama Gateway can call this"
    );
    _;
}
```

### Callback Request Tracking

```solidity
struct MatchContext {
    uint256 sellOrderId;
    uint256 buyOrderId;
    Stage   currentStage;
    bool    buyIsSmaller;    // stored after stage 2 for use in stage 3
    euint64 fillSize;        // stored after TFHE.select for use in settlement
    euint64 remainder;       // stored after TFHE.sub for use in requeue
}
mapping(uint256 => MatchContext) public pendingRequests;
```

Each `Gateway.requestDecryption` call returns a `requestId`. The matcher contract maps `requestId → MatchContext` so callbacks know which match they belong to.

---

## 10. Access Control Model

### The ACL Contract

FHEVM uses a centralized Access Control List (ACL) contract deployed at `0xFee8407e2f5e3Ee68ad77cAE98c434e637f516e5` on Sepolia.

Every encrypted value (ciphertext handle) must have explicit permissions granted or it cannot be used. Failing to call `allowThis` / `allow` is the single most common bug in FHEVM development — the operation silently uses a zero-value or reverts with `TFHESenderNotAllowed`.

### Permission Matrix

| Encrypted Value | `allowThis` | `allow(trader)` | `allow(escrow)` | `allow(matcher)` | `allow(settlement)` |
|---|---|---|---|---|---|
| `encMinPrice` | ✅ | ✅ seller | ✅ | ✅ | ✅ |
| `encBidPrice` | ✅ | ✅ buyer | ✅ | ✅ | ✅ |
| `encSellSize` | ✅ | ✅ seller | ✅ | ✅ | ✅ |
| `encBuySize` | ✅ | ✅ buyer | ✅ | ✅ | ✅ |
| `priceMatched` (ebool) | ✅ | ❌ | ✅ | ✅ | ❌ |
| `buyIsSmaller` (ebool) | ✅ | ❌ | ✅ | ✅ | ❌ |
| `fillSize` | ✅ | ✅ both | ✅ | ✅ | ✅ |
| `remainder` | ✅ | ✅ owner | ✅ | ✅ | ❌ |
| `payment` | ✅ | ✅ both | ❌ | ❌ | ✅ |

**Rule:** After every `TFHE.op()` that produces a new ciphertext handle, immediately call `allowThis` on the result. Before the function returns, call `allow(address)` for every contract or EOA that will need to use that value.

### Re-encryption for User Decryption

Traders can decrypt their own order parameters using EIP-712 re-encryption:

```javascript
// Frontend: trader requests their own fill confirmation
const instance = await createInstance({ chainId, publicKey });
const { publicKey: userPubKey, signature } = await instance.generateKeypair();

const reencrypted = await contract.reencryptFillSize(
    orderId,
    userPubKey,
    signature
);

const decrypted = instance.decrypt(contractAddress, reencrypted);
// Returns the actual fill size only to this user's private key
```

The `publicKey` in `allow(publicKey, trader)` is the FHE public key — distinct from the wallet public key. Zama's `@zama-fhe/relayer-sdk` handles key management.

---

## 11. Token Decimal Design

### The Decimal Constraint

`ConfidentialERC20` (base contract) defaults to `6` decimals. This is a design choice optimized for `euint64` — using 18 decimals would reduce the max representable value from $18T to $18 at $1/token.

**For `cETH`:**
- 6 decimals → 1 cETH = `1,000,000` units
- Max representable: `18,446,744,073,709` cETH — far beyond total ETH supply

**For `cUSDT`:**
- Source USDT already has 6 decimals — perfect match, no scaling needed
- `ConfidentialERC20Wrapped` requires source `decimals() >= 6` — ✅ satisfied

**For `cETH` wrapping WETH:**
- WETH has 18 decimals, cETH wrapper uses 6 decimals
- Zama's `ConfidentialERC20Wrapped` scales the amount internally by `_rate = 10^(sourceDecimals - 6) = 10^12`
- Users deposit WETH → contract scales down by 10^12 → stores as 6-decimal cETH
- On unwrap, scales back up

### Price Unit Convention

All prices in this system are denominated as:
> **cUSDT units per cETH unit** (both in 6-decimal representation)

Example: ETH at $3,500:
```
price = 3,500 * 10^6 / 10^6 = 3,500,000 (in 6-decimal cUSDT per 1 full cETH)
```

Wait — more precisely:
```
price per unit of cETH = 3,500 USDT = 3,500 * 10^6 USDT-units = 3,500,000,000
```
This fits comfortably in `euint64` (max ~18.4 × 10^18).

For the multiplication `fillSize * fillPrice`:
```
fillSize   = e.g. 100,000 ETH = 100,000 * 10^6 units = 10^11
fillPrice  = 3,500 * 10^6 = 3.5 × 10^9
product    = 10^11 × 3.5×10^9 = 3.5×10^20
```

⚠️ **This overflows `euint64`** (max ~1.8×10^19). For `fillSize * fillPrice` multiplication, use `euint128` for the intermediate product, then check the result fits in `euint64` before storing.

```solidity
euint128 payment128 = TFHE.mul(
    TFHE.asEuint128(fillSize), 
    TFHE.asEuint128(fillPrice)
);
// payment128 is in cUSDT-units * cETH-units / cETH-unit = cUSDT-units
// Cast back if safe, or keep as euint128 for the transfer
```

This is the one case where `euint128` is needed: the payment calculation.

---

## 12. Frontend Architecture

### Tech Stack
- **Framework:** React + TypeScript + Vite
- **FHE Client:** `@zama-fhe/relayer-sdk` v0.4.1+
- **Blockchain:** `ethers.js` v6 + MetaMask / WalletConnect
- **Styling:** Tailwind CSS
- **State:** React Query for order polling

### Key Pages

#### Trader Dashboard
```
┌──────────────────────────────────────────────────────┐
│  ⬛ SHADOWPOOL — Institutional Dark Pool              │
│  Connected: 0x742d...3f8a  [Sepolia]                 │
├──────────────────────────────────────────────────────┤
│  YOUR BALANCES                                       │
│  cETH:  [encrypted — click to decrypt]              │
│  cUSDT: [encrypted — click to decrypt]              │
├──────────────────────────────────────────────────────┤
│  SUBMIT ORDER                                        │
│  ○ SELL  ● BUY                                      │
│                                                      │
│  Size:  [____________] cETH                         │
│  Price: [____________] USDT/ETH (max bid)           │
│                                                      │
│  [ENCRYPT & SUBMIT]                                  │
├──────────────────────────────────────────────────────┤
│  YOUR ORDERS                                         │
│  #1847  SELL  —  ● PARTIALLY FILLED                 │
│         Remainder requeued as #1851                 │
│         [Decrypt my fill size]                      │
│                                                      │
│  #1851  SELL  —  ○ OPEN (waiting for buyer)         │
│         Submitted 4m ago                            │
└──────────────────────────────────────────────────────┘
```

#### Public Activity Feed
```
┌──────────────────────────────────────────────────────┐
│  POOL ACTIVITY  (amounts never shown)                │
├──────────────────────────────────────────────────────┤
│  14:23:01  Order #1851  SELL  OPEN                  │
│  14:22:58  Order #1847  SELL  PARTIAL_FILL → #1851  │
│  14:22:55  Order #1847 + #1849  SETTLED             │
│  14:22:46  Order #1849  BUY   MATCHED               │
│  14:22:38  Order #1849  BUY   OPEN                  │
│  14:22:31  Order #1847  SELL  OPEN                  │
└──────────────────────────────────────────────────────┘
```

Notice: **no amounts, no prices visible anywhere in the public feed.**

### Client-Side Encryption Flow

```typescript
// 1. Initialize FHEVM instance
const instance = await createInstance({
  chainId: 11155111, // Sepolia
  networkUrl: "https://sepolia.infura.io/v3/...",
  gatewayUrl: "https://gateway.sepolia.zama.ai",
});

// 2. Create encrypted inputs
const input = instance.createEncryptedInput(
  escrowContractAddress,
  userWalletAddress
);
input.add64(orderSize);    // e.g. 100_000_000_000 (100,000 ETH in 6-decimal units)
input.add64(orderPrice);   // e.g. 3_500_000_000 (3500 USDT in 6-decimal units)

// 3. Generate ciphertexts + ZK input proofs
const encrypted = await input.encrypt();
// encrypted.handles[0] = encOrderSize (bytes32 ciphertext handle)
// encrypted.handles[1] = encOrderPrice
// encrypted.inputProof  = ZK proof (one proof covers all inputs in one call)

// 4. Submit to contract
await escrow.submitSellOrder(
  encrypted.handles[0], encrypted.inputProof,
  encrypted.handles[1], encrypted.inputProof
);
```

### User Decryption Flow

```typescript
// Trader requests to see their own fill size
const { publicKey, privateKey } = instance.generateKeypair();
const eip712sig = await signer.signTypedData(...);

const reencrypted = await escrow.reencryptFillSize(orderId, publicKey, eip712sig);
const plaintext = instance.decrypt(escrowAddress, reencrypted);

console.log(`Your fill: ${Number(plaintext) / 1e6} ETH`);
```

---

## 13. Security Model

### Threat Model

| Threat | Mitigation |
|---|---|
| **Front-running** | All order parameters encrypted. MEV bots see nothing actionable. |
| **Information leakage via order existence** | Binary flag only — "a sell order exists." No size, price, or owner revealed. |
| **Ciphertext replay attack** | Input proofs bind ciphertext to sender + block. Cannot replay another user's encrypted order. |
| **Callback spoofing** | `onlyGateway` modifier — only Zama Gateway contract can deliver callback results. |
| **Race condition on partial fills** | `Locked` status + `orderNotLocked` modifier blocks new match attempts during pending callbacks. |
| **Silent arithmetic overflow** | `FHE.select` pattern guarantees subtraction direction. `fillSize = min(a,b)` → both remainders ≥ 0. |
| **Malformed ciphertext input** | `FHE.fromExternal(enc, proof)` verifies the proof — rejects malformed or mismatched inputs. |
| **Unauthorized token transfer** | `confidentialTransferFrom` requires `approve` — same as ERC-20. Escrow can only pull approved amounts. |
| **Griefing (occupy slot without intent to trade)** | Cancellation is permissioned to order owner. Slot is cleared on cancel. (v2: add time-lock or deposit bond) |

### What FHE Does NOT Protect Against

- **Timing analysis:** The existence of a match (two orders settled within a short window) could imply approximate size relationship. Cannot be fixed with FHE alone.
- **Gas amount correlation:** An unusually high gas expenditure on `submitBuyOrder` might hint at a large notional (since `TFHE.mul(size, price)` gas scales with operand size). Mitigation: fixed gas overhead via padding.
- **Coprocessor trust:** The Zama FHE coprocessor (13 MPC nodes, 2/3 threshold) sees ciphertext only, not plaintext. But the decryption service must be trusted to be threshold-honest. This is a protocol-level trust assumption, not a contract-level one.

---

## 14. Gas Analysis

### Per-Operation FHE Gas Costs (Sepolia estimates)

| Operation | Type | Gas Cost |
|---|---|---|
| `TFHE.asEuint64(enc, proof)` | Input verification | ~100,000 |
| `TFHE.ge(euint64, euint64)` | Comparison | ~188,000 |
| `TFHE.le(euint64, euint64)` | Comparison | ~188,000 |
| `TFHE.gt(euint64, euint64)` | Comparison | ~188,000 |
| `TFHE.select(ebool, euint64, euint64)` | Conditional | ~120,000 |
| `TFHE.sub(euint64, euint64)` | Arithmetic | ~150,000 |
| `TFHE.mul(euint64, euint64)` | Arithmetic | ~300,000 |
| `TFHE.mul(euint128, euint128)` | Arithmetic | ~500,000 |
| `allowThis` + `allow` pair | ACL | ~30,000 |
| `Gateway.requestDecryption` | Gateway dispatch | ~80,000 |

### Full Match Cycle Gas Budget

| Step | Operations | Estimated Gas |
|---|---|---|
| `submitSellOrder` | 2× input verify, 2× allowThis+allow | ~260,000 |
| `submitBuyOrder` + match trigger | 2× input verify, mul(escrow notional), allowances, Gateway request | ~780,000 |
| `priceCheckCallback` | ge, Gateway request | ~300,000 |
| `sizeCompareCallback` | le, select×2, sub×2, allowances, Gateway request | ~1,000,000 |
| `DarkPoolSettlement.settle` | mul(payment), select×3, transfers, refund | ~900,000 |
| `remainderCheckCallback` | gt, requeue logic | ~300,000 |
| **Total per full partial fill** | | **~3,540,000 gas** |

On Sepolia this costs approximately **0.07–0.15 ETH** at 20–40 gwei. On mainnet with optimized gas, significantly less. All on-chain gas is payable by the submitting traders.

---

## 15. Testing Strategy

### Local Hardhat Tests (Mock Mode)

On local Hardhat, the `@fhevm/hardhat-plugin` provides a mock FHE environment. Operations complete synchronously — no Gateway round trips. `fhevm.isMock === true`.

```typescript
import { fhevm } from "hardhat";

describe("DarkPoolMatcher", () => {
  it("should match when bid >= ask", async () => {
    const sellPrice = 3000_000000n;  // 3000 USDT
    const buyPrice  = 3500_000000n;  // 3500 USDT (bid above ask → should match)
    const sellSize  = 1000_000000n;  // 1000 ETH
    const buySize   =  500_000000n;  // 500 ETH (partial fill)

    const [seller, buyer] = await ethers.getSigners();

    // Encrypt inputs locally (mock mode — no real FHE)
    const sellInput = fhevm.createEncryptedInput(escrow.address, seller.address);
    sellInput.add64(sellPrice);
    sellInput.add64(sellSize);
    const sellEnc = await sellInput.encrypt();

    const buyInput = fhevm.createEncryptedInput(escrow.address, buyer.address);
    buyInput.add64(buyPrice);
    buyInput.add64(buySize);
    const buyEnc = await buyInput.encrypt();

    await escrow.connect(seller).submitSellOrder(
      sellEnc.handles[0], sellEnc.inputProof,
      sellEnc.handles[1], sellEnc.inputProof
    );
    await escrow.connect(buyer).submitBuyOrder(
      buyEnc.handles[0], buyEnc.inputProof,
      buyEnc.handles[1], buyEnc.inputProof
    );

    // In mock mode, Gateway callbacks fire synchronously
    // Fast-forward: check settled event
    const filter = settlement.filters.Settled();
    const events = await settlement.queryFilter(filter);
    expect(events.length).to.equal(1);

    // Verify partial fill: seller should have remainder order
    const remainderOrderId = await escrow.activeSellOrderId();
    expect(remainderOrderId).to.not.equal(0);
  });

  it("should NOT match when bid < ask", async () => { ... });
  it("should refund both sides on no-match", async () => { ... });
  it("should handle exact size match (no remainder)", async () => { ... });
  it("should block new match on Locked order", async () => { ... });
  it("should allow cancellation of Open order only", async () => { ... });
});
```

### Sepolia Integration Tests

```typescript
// gates/sepolia.test.ts — only runs when fhevm.isMock === false
if (!fhevm.isMock) {
  it("should complete full Gateway callback cycle on Sepolia", async () => {
    // Submit orders
    const tx1 = await escrow.connect(seller).submitSellOrder(...);
    await tx1.wait();
    const tx2 = await escrow.connect(buyer).submitBuyOrder(...);
    await tx2.wait();

    // Wait for Gateway (max 30s)
    await new Promise(resolve => setTimeout(resolve, 30_000));

    // Check settled
    const events = await settlement.queryFilter(settlement.filters.Settled());
    expect(events.length).to.equal(1);
  });
}
```

### Test Coverage Targets

| Module | Target Coverage |
|---|---|
| `DarkPoolToken` | 90% |
| `DarkPoolEscrow` | 95% |
| `DarkPoolMatcher` (state machine) | 100% |
| `DarkPoolSettlement` | 95% |
| Frontend encrypt/decrypt flow | E2E playwright test |

---

## 16. Deployment Plan

### Contracts Deployment Order

```
1. Deploy underlying tokens (mock WETH, mock USDT) on Sepolia
   → Note addresses: WETH_ADDRESS, USDT_ADDRESS

2. Deploy DarkPoolToken("Confidential ETH", "cETH", WETH_ADDRESS)
   → Note: CETH_ADDRESS

3. Deploy DarkPoolToken("Confidential USDT", "cUSDT", USDT_ADDRESS)
   → Note: CUSDT_ADDRESS

4. Deploy DarkPoolSettlement(CETH_ADDRESS, CUSDT_ADDRESS)
   → Note: SETTLEMENT_ADDRESS

5. Deploy DarkPoolMatcher(SETTLEMENT_ADDRESS)
   → Note: MATCHER_ADDRESS

6. Deploy DarkPoolEscrow(CETH_ADDRESS, CUSDT_ADDRESS, MATCHER_ADDRESS)
   → Note: ESCROW_ADDRESS

7. Configure permissions:
   → DarkPoolMatcher.setEscrow(ESCROW_ADDRESS)
   → DarkPoolSettlement.setMatcher(MATCHER_ADDRESS)
   → cETH.approve(ESCROW_ADDRESS, type(uint64).max) [contract-level approval for escrow]
   → cUSDT.approve(ESCROW_ADDRESS, type(uint64).max)
```

### Hardhat Deploy Script Structure

```typescript
// deploy/00_deploy_tokens.ts
// deploy/01_deploy_settlement.ts
// deploy/02_deploy_matcher.ts
// deploy/03_deploy_escrow.ts
// deploy/04_configure.ts
```

### Environment Variables Required

```bash
MNEMONIC=          # deployer wallet seed
INFURA_API_KEY=    # Sepolia RPC
ETHERSCAN_API_KEY= # contract verification
```

---

## 17. Known Constraints & Limitations

### v1 Limitations (By Design)

1. **Single active order per side.** If a sell order is open and a second seller tries to submit, it reverts. One slot per side. Simplifies state machine enormously for v1.

2. **Single token pair.** `cETH/cUSDT` only. Multi-pair support would require a pair registry and per-pair escrow contracts.

3. **No on-chain price feed.** The settlement price is the bid price (buyer pays their stated maximum). A mid-point price mechanism (TradFi standard) would require additional encrypted arithmetic.

4. **Gateway latency.** 3 callbacks × ~5s = ~15s for partial fill settlement. Not a problem for block trades (institutional traders expect T+minutes, not T+milliseconds).

5. **No order book depth.** One sell, one buy, match or don't. Real dark pools maintain hidden queues. This is v1 — proof of concept.

6. **Griefing vector.** A malicious actor can occupy the sell slot with a tiny order at an unreachable price, preventing legitimate sellers from submitting. Mitigation in v2: minimum order size, time-lock expiry, or bond.

7. **`ConfidentialERC20.decimals()` is hardcoded to 6.** Cannot be changed without forking the base contract. Design your token amounts accordingly.

### FHEVM Protocol Constraints

8. **`euint256` limited ops.** `euint256` only supports bitwise ops, equality, and shift — NOT arithmetic. If you need large arithmetic, use `euint128` (full ops).

9. **Encrypted division RHS must be plaintext.** `TFHE.div(a, encB)` panics. Only `TFHE.div(a, plaintextB)` is supported. This affects any fee calculation.

10. **`fhevm.isMock` gates.** Tests that rely on real Gateway callbacks will hang indefinitely on local Hardhat. Always gate with `if (!fhevm.isMock)`.

---

## 18. What This Is Not

To be absolutely clear for the pitch:

- **Not an AMM.** There is no curve. No `x*y=k`. No LP positions. No discoverable price from pool state.
- **Not a ZK dark pool.** ZK proves correctness *to a verifier who sees the inputs*. A ZK dark pool still requires a trusted operator who sees all orders in plaintext. FHE requires no trusted operator — the matching engine is the ciphertext itself.
- **Not Penumbra/CAMM/Aztec Connect.** Those hide amounts after execution. ShadowPool hides amounts *during* matching computation on-chain.
- **Not a mixer or tumbler.** There is no anonymization of the sender address. The wallet address that submitted an order is public. Only the order parameters (size, price) are private.

---

## 19. Future Roadmap

### v2 — Multi-Order Queue
- Maintain an encrypted priority queue per side
- Match FIFO within price bands
- Requires encrypted sorting primitives (not yet available in FHEVM — future Zama roadmap item)

### v3 — Mid-Point Pricing
- Execution price = (bid + ask) / 2 — standard dark pool pricing
- Requires `TFHE.add(bid, ask)` and `TFHE.div(sum, 2)` — division by plaintext is supported
- Gas: +~150k per match

### v4 — Multi-Pair Registry
- Factory pattern: `DarkPoolFactory.createPair(tokenA, tokenB)`
- Each pair gets its own Escrow + Matcher + Settlement
- Shared Settlement library

### v5 — Compliance Layer
- Encrypted KYC attestation: trade only if both parties hold a valid credential
- `TFHE.and(sellerKYC, buyerKYC)` — gate settlement on encrypted compliance check
- No counterparty learns the other's KYC status

### v6 — Mainnet
- Zama mainnet launch (announced for Q4 2025, now rolling out)
- Real institutional tokens (WBTC, wstETH, USDC)
- Zama commercial patent license required for production use

---

## 20. Glossary

| Term | Definition |
|---|---|
| **FHE** | Fully Homomorphic Encryption — allows computation on encrypted data without decryption |
| **FHEVM** | Zama's FHE Virtual Machine — extends the EVM with FHE types and operations |
| **TFHE** | The specific FHE scheme used by Zama (Torus FHE). Also the Solidity namespace in `fhevm-contracts` |
| **`euint64`** | Encrypted 64-bit unsigned integer. Ciphertext handle stored on-chain. |
| **`ebool`** | Encrypted boolean. Result of FHE comparisons (`TFHE.ge`, `TFHE.le`, etc.) |
| **Ciphertext handle** | A `bytes32` pointer to an encrypted value stored in the coprocessor's DA layer |
| **ACL** | Access Control List — FHEVM contract that governs which addresses can use which ciphertext handles |
| **Input proof** | ZK proof bundled with encrypted input, binding the ciphertext to the sender and block |
| **Gateway** | Zama's decryption service — receives encrypted `ebool` results and delivers plaintext booleans to contract callbacks |
| **Coprocessor** | Off-chain service that performs FHE computation. Monitors chain, computes on ciphertext, posts results. |
| **Re-encryption** | User-initiated decryption of their own data using EIP-712 — the only way a user can see their own encrypted balances |
| **ERC-7984** | Draft standard for confidential tokens. Extends ERC-20 with encrypted amounts. Transfer events use placeholder max value. |
| **`ConfidentialERC20Wrapped`** | Zama's wrapper that converts a standard ERC-20 into an ERC-7984 confidential token |
| **Dark pool** | Private trading venue where large block orders are matched away from the public order book |
| **Block trade** | A single large institutional trade, typically $10M–$1B+, that cannot be executed on public markets without significant price impact |
| **Partial fill** | When a match is made but one side's order is larger — the excess is requeued as a new order |
| **MEV** | Maximal Extractable Value — profit extracted by block producers or bots from reordering/front-running transactions |
| **`allowThis`** | FHEVM ACL call granting the current contract permission to use a ciphertext handle |
| **`allow(addr)`** | FHEVM ACL call granting a specific address permission to use a ciphertext handle |
| **`_transferNoEvent`** | The correct override point in `fhevm-contracts` ConfidentialERC20 (NOT `_update`) |
| **`_unsafeMint`** | Low-level mint in `fhevm-contracts` — does NOT update `totalSupply`. Caller must update manually. |

---

*Built with Zama FHEVM. The matching engine never sees your price. Only the outcome is public.*

---

## 21. Multi-Token Factory Extension

> **Status:** Addendum to v1 spec. This extends the system to support arbitrary ERC-20 token pairs beyond the hardcoded `cETH/cUSDT` pair. This is the on-ramp for any standard ERC-20 token into the dark pool without any changes to the core matching/settlement contracts.

---

### 21.1 The Problem with Hardcoded Tokens

The v1 spec hardcodes `cETH` and `cUSDT` addresses directly into `DarkPoolEscrow` and `DarkPoolSettlement` constructors:

```solidity
// v1 — hardcoded, only one pair ever
constructor(address cETH, address cUSDT) { ... }
```

This means only one token pair can ever use the dark pool. To support `WBTC/USDC`, `ARB/USDT`, or any other pair, you would have to manually redeploy all four contracts (`Token × 2`, `Escrow`, `Matcher`, `Settlement`) by hand and wire them up.

The factory pattern automates this entirely and supports unlimited pairs.

---

### 21.2 How Any Standard ERC-20 Enters the Pool

Any normal ERC-20 token (WETH, WBTC, USDC, ARB, etc.) is supported via the **wrap/unwrap pattern**. The token itself never changes — a confidential wrapper is deployed around it:

```
Standard ERC-20 token (e.g. WBTC)
        ↓  user calls deposit()
cToken wrapper (e.g. cWBTC) — ERC-7984 confidential
        ↓  submitted as encrypted order to dark pool
Dark pool matches & settles (fully encrypted)
        ↓  user calls withdraw()
Standard ERC-20 token (WBTC) — back in user's wallet
```

The underlying ERC-20 is locked 1:1 in the wrapper contract for the duration of the trade. No bridges, no synthetic assets, no custodians.

**Decimal constraint reminder (from Section 17, constraint #7):** The `ConfidentialERC20Wrapped` base hardcodes `decimals()` to `6`. Tokens with 18 decimals (WETH, WBTC, ARB, etc.) are scaled internally by `_rate = 10^(sourceDecimals - 6)` on deposit and scaled back on withdraw. This is handled automatically by the Zama base contract. You only need to ensure the source token has `decimals() >= 6`.

---

### 21.3 `DarkPoolFactory.sol`

**Purpose:** Deploys and registers a full dark pool stack (wrapper tokens + escrow + matcher + settlement) for any arbitrary ERC-20 pair in a single transaction.

**Key design decisions:**
- One `Escrow + Matcher + Settlement` set per pair — pairs are fully isolated
- Wrapper tokens (`cTokenA`, `cTokenB`) are reused if already deployed for a given underlying ERC-20
- Pair is identified by a canonical hash of `(tokenA, tokenB)` — order-normalized so `(WETH, USDC)` and `(USDC, WETH)` resolve to the same pair
- Factory is the deployer and initial admin of all child contracts

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DarkPoolToken }      from "./DarkPoolToken.sol";
import { DarkPoolEscrow }     from "./DarkPoolEscrow.sol";
import { DarkPoolMatcher }    from "./DarkPoolMatcher.sol";
import { DarkPoolSettlement } from "./DarkPoolSettlement.sol";

contract DarkPoolFactory {

    // ─── Structs ───────────────────────────────────────────────────────────

    struct Pair {
        address tokenA;          // underlying ERC-20 (canonical lower address)
        address tokenB;          // underlying ERC-20 (canonical higher address)
        address cTokenA;         // confidential wrapper for tokenA
        address cTokenB;         // confidential wrapper for tokenB
        address escrow;
        address matcher;
        address settlement;
        bool    exists;
    }

    // ─── Storage ───────────────────────────────────────────────────────────

    // pairHash → Pair
    mapping(bytes32 => Pair) public pairs;

    // underlying ERC-20 → its confidential wrapper (reused across pairs)
    mapping(address => address) public wrapperOf;

    // all registered pair hashes for enumeration
    bytes32[] public allPairHashes;

    // ─── Events ────────────────────────────────────────────────────────────

    event PairCreated(
        address indexed tokenA,
        address indexed tokenB,
        address cTokenA,
        address cTokenB,
        address escrow,
        address matcher,
        address settlement,
        bytes32 pairHash
    );

    event WrapperDeployed(
        address indexed underlying,
        address indexed wrapper
    );

    // ─── Core: Create Pair ─────────────────────────────────────────────────

    /// @notice Deploy a full dark pool stack for any two standard ERC-20 tokens.
    /// @param tokenA Address of the first underlying ERC-20.
    /// @param tokenB Address of the second underlying ERC-20.
    /// @param nameA  Name for the confidential wrapper of tokenA (e.g. "Confidential WBTC").
    /// @param symbolA Symbol for the confidential wrapper of tokenA (e.g. "cWBTC").
    /// @param nameB  Name for the confidential wrapper of tokenB.
    /// @param symbolB Symbol for the confidential wrapper of tokenB.
    /// @return escrow Address of the deployed DarkPoolEscrow for this pair.
    function createPair(
        address tokenA,
        address tokenB,
        string calldata nameA,
        string calldata symbolA,
        string calldata nameB,
        string calldata symbolB
    ) external returns (address escrow) {

        // Normalize pair order — always (lower address, higher address)
        (address t0, address t1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        bytes32 pairHash = keccak256(abi.encodePacked(t0, t1));
        require(!pairs[pairHash].exists, "DarkPoolFactory: pair already exists");

        // ── 1. Deploy or reuse confidential wrappers ──────────────────────
        address cT0 = _getOrDeployWrapper(t0, nameA, symbolA);
        address cT1 = _getOrDeployWrapper(t1, nameB, symbolB);

        // ── 2. Deploy Settlement ──────────────────────────────────────────
        DarkPoolSettlement settlement_ = new DarkPoolSettlement(cT0, cT1);

        // ── 3. Deploy Matcher ─────────────────────────────────────────────
        DarkPoolMatcher matcher_ = new DarkPoolMatcher(address(settlement_));

        // ── 4. Deploy Escrow ──────────────────────────────────────────────
        DarkPoolEscrow escrow_ = new DarkPoolEscrow(cT0, cT1, address(matcher_));

        // ── 5. Wire permissions ───────────────────────────────────────────
        matcher_.setEscrow(address(escrow_));
        settlement_.setMatcher(address(matcher_));

        // ── 6. Register pair ──────────────────────────────────────────────
        pairs[pairHash] = Pair({
            tokenA:     t0,
            tokenB:     t1,
            cTokenA:    cT0,
            cTokenB:    cT1,
            escrow:     address(escrow_),
            matcher:    address(matcher_),
            settlement: address(settlement_),
            exists:     true
        });
        allPairHashes.push(pairHash);

        emit PairCreated(t0, t1, cT0, cT1, address(escrow_), address(matcher_), address(settlement_), pairHash);

        return address(escrow_);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    function _getOrDeployWrapper(
        address underlying,
        string calldata name,
        string calldata symbol
    ) internal returns (address) {
        if (wrapperOf[underlying] != address(0)) {
            // Reuse existing wrapper — same underlying can participate in multiple pairs
            return wrapperOf[underlying];
        }
        DarkPoolToken wrapper = new DarkPoolToken(underlying, name, symbol);
        wrapperOf[underlying] = address(wrapper);
        emit WrapperDeployed(underlying, address(wrapper));
        return address(wrapper);
    }

    /// @notice Look up the pair struct for two tokens (order-independent).
    function getPair(address tokenA, address tokenB) external view returns (Pair memory) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return pairs[keccak256(abi.encodePacked(t0, t1))];
    }

    /// @notice Total number of registered pairs.
    function pairCount() external view returns (uint256) {
        return allPairHashes.length;
    }
}
```

---

### 21.4 Updated `DarkPoolEscrow.sol` Constructor

To support the factory pattern, `DarkPoolEscrow` must accept any pair of confidential token addresses — not hardcoded `cETH`/`cUSDT`. The only change required is making the constructor generic:

```solidity
// v1 — hardcoded names, same logic
constructor(address _cETH, address _cUSDT, address _matcher) {
    cETH    = IConfidentialERC20(_cETH);
    cUSDT   = IConfidentialERC20(_cUSDT);
    matcher = _matcher;
}

// v2 — generic, factory-compatible (rename internal vars)
constructor(address _cTokenA, address _cTokenB, address _matcher) {
    cTokenA = IConfidentialERC20(_cTokenA);
    cTokenB = IConfidentialERC20(_cTokenB);
    matcher = _matcher;
}
```

No changes to matching logic, settlement logic, FHE operations, Gateway callbacks, or ACL rules. The pair is simply parameterized at deploy time.

The same applies to `DarkPoolSettlement.sol` — replace `cETH`/`cUSDT` references with `cTokenA`/`cTokenB` in the constructor and internal transfer calls.

---

### 21.5 Full User Flow for a New Token Pair

Below is the complete end-to-end flow for a trader wanting to dark-pool swap `WBTC` for `USDC` — two standard ERC-20 tokens with no prior pool:

```
Step 1 — Anyone calls factory.createPair(WBTC, USDC, ...)
          → cWBTC wrapper deployed (or reused)
          → cUSDC wrapper deployed (or reused)
          → Settlement, Matcher, Escrow deployed and wired
          → PairCreated event emitted

Step 2 — Seller (has WBTC, wants USDC):
          WBTC.approve(cWBTC_address, amount)
          cWBTC.deposit(amount)                  → seller now holds encrypted cWBTC
          cWBTC.approve(escrow_address, amount)
          escrow.submitSellOrder(encMinPrice, proof, encSellSize, proof)
          → cWBTC locked in escrow
          → Order sits Open, waiting for buyer

Step 3 — Buyer (has USDC, wants WBTC):
          USDC.approve(cUSDC_address, amount)
          cUSDC.deposit(amount)                  → buyer now holds encrypted cUSDC
          cUSDC.approve(escrow_address, amount)
          escrow.submitBuyOrder(encBidPrice, proof, encBuySize, proof)
          → cUSDC locked in escrow (worst-case notional)
          → Both sides active → _triggerMatchAttempt fires

Step 4 — Gateway callbacks execute (same as v1 — Section 9)
          → Price check → Size compare → Settlement → Partial fill requeue (if needed)

Step 5 — After settlement:
          Seller: cUSDC.withdraw(amount) → USDC in wallet
          Buyer:  cWBTC.withdraw(amount) → WBTC in wallet
```

At no point during steps 2–4 does anyone — including the block producer — see the price, size, or counterparty of either order.

---

### 21.6 Token Compatibility Requirements

Not every ERC-20 token is compatible with `ConfidentialERC20Wrapped`. Before calling `createPair`, verify:

| Requirement | Why |
|---|---|
| `decimals() >= 6` | Zama base contract requirement. Tokens with fewer than 6 decimals (rare) cannot be wrapped. |
| Standard `transfer` / `transferFrom` returns `bool` | Non-standard tokens (e.g. old USDT on mainnet) that return `void` will revert on wrap. Use a SafeERC20-compatible wrapper first if needed. |
| No rebase / fee-on-transfer mechanics | Rebase tokens (stETH, AMPL) change balances externally — the 1:1 deposit/withdraw invariant breaks. Not supported in v1. |
| Not a native gas token | `ETH` itself cannot be wrapped — use `WETH` (standard ERC-20 wrapper of ETH). |

Fee-on-transfer and rebase token support is a v5+ roadmap item requiring custom wrapper logic.

---

### 21.7 Reusing Wrappers Across Pairs

A given underlying ERC-20 gets exactly one confidential wrapper, regardless of how many pairs it participates in. The factory tracks this in `wrapperOf[underlying]`.

Example: if `USDC` is used in both `WBTC/USDC` and `ARB/USDC` pairs:

```
createPair(WBTC, USDC) → deploys cWBTC + cUSDC, registers pair
createPair(ARB,  USDC) → deploys cARB, REUSES existing cUSDC, registers pair
```

This means a user's `cUSDC` balance is fungible across all pairs that use USDC. They wrap once, trade in any USDC pair, unwrap once. No per-pair token balances to manage.

---

### 21.8 Factory Deployment and Hardhat Script

Add to the deployment sequence (after Section 16's existing steps):

```typescript
// deploy/05_deploy_factory.ts
import { ethers } from "hardhat";

async function main() {
  const Factory = await ethers.getContractFactory("DarkPoolFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  console.log("DarkPoolFactory deployed at:", await factory.getAddress());

  // Optionally pre-create the default cETH/cUSDT pair via factory
  const tx = await factory.createPair(
    process.env.WETH_ADDRESS!,
    process.env.USDT_ADDRESS!,
    "Confidential ETH",  "cETH",
    "Confidential USDT", "cUSDT"
  );
  const receipt = await tx.wait();
  console.log("Default cETH/cUSDT pair created. Tx:", receipt.hash);
}

main().catch(console.error);
```

**Updated environment variables:**

```bash
MNEMONIC=
INFURA_API_KEY=
ETHERSCAN_API_KEY=
WETH_ADDRESS=          # underlying WETH on Sepolia
USDT_ADDRESS=          # underlying mock USDT on Sepolia
FACTORY_ADDRESS=       # set after deploy/05 runs
```

---

### 21.9 Frontend: Pair Selector UI

The trader UI gains a pair selector. On load, the frontend reads all registered pairs from the factory and populates a dropdown:

```typescript
// Read all pairs from factory
const pairCount = await factory.pairCount();
const pairHashes = await Promise.all(
  Array.from({ length: Number(pairCount) }, (_, i) => factory.allPairHashes(i))
);
const pairData = await Promise.all(
  pairHashes.map(h => factory.pairs(h))
);

// Each pairData entry: { tokenA, tokenB, cTokenA, cTokenB, escrow, ... }
// Display as: "WBTC / USDC", "ARB / USDT", "ETH / USDC" etc.
```

When a trader selects a pair, the frontend points all subsequent `submitSellOrder` / `submitBuyOrder` calls at that pair's `escrow` address. The encryption flow (Section 12) is identical — only the target contract address changes.

---

### 21.10 Summary: What Changes vs v1

| Component | v1 (Hardcoded) | v2 (Factory) |
|---|---|---|
| `DarkPoolToken` | Deployed manually ×2 | Deployed by factory, reused across pairs |
| `DarkPoolEscrow` | Hardcoded `cETH`, `cUSDT` | Generic `cTokenA`, `cTokenB` constructor args |
| `DarkPoolMatcher` | Hardcoded to one escrow | Same — receives escrow address from factory |
| `DarkPoolSettlement` | Hardcoded `cETH`, `cUSDT` | Generic `cTokenA`, `cTokenB` constructor args |
| `DarkPoolFactory` | Does not exist | New contract — deploys & registers all pairs |
| Supported pairs | 1 (`cETH/cUSDT`) | Unlimited (any ERC-20 with `decimals() >= 6`) |
| FHE matching logic | Unchanged | Unchanged — factory only affects deployment |
| Gateway callbacks | Unchanged | Unchanged |
| Security model | Unchanged | Unchanged |
| User wrap/unwrap step | Required | Required (same flow, any token) |