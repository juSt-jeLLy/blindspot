# ShadowPool Contracts (FHEVM)

This workspace contains the Solidity implementation for:

- `DarkPoolToken.sol`: confidential ERC-7984 wrapper token.
- `DarkPoolEscrow.sol`: encrypted order intake and token escrow.
- `DarkPoolMatcher.sol`: encrypted matching + partial fill branching.
- `DarkPoolSettlement.sol`: confidential settlement transfers.
- `DarkPoolFactory.sol`: pair deployment and registry.
  - includes gateway address wiring for callback authorization.

## Local setup

```bash
cd contracts
npm install
npm run build
npm test
```

### Deploy script

```bash
cd contracts
GATEWAY_ADDRESS=0x... TOKEN_A=0x... TOKEN_B=0x... npm run deploy:local
SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=... GATEWAY_ADDRESS=0x... TOKEN_A=0x... TOKEN_B=0x... npm run deploy:sepolia
```

## Frontend integration

1. Deploy `DarkPoolFactory`.
2. Call `createPair(tokenA, tokenB, nameA, symbolA, nameB, symbolB)`.
3. Read `Pair` from `getPair(tokenA, tokenB)`.
4. Send encrypted orders to the returned `escrow` address.
5. Watch events:
- `SellOrderSubmitted`
- `BuyOrderSubmitted`
- `MatchTriggered`
- `PartialFill`
- `Settled`

## Notes

- Pair supports single active order per side by design (v1 model).
- Pair supports multi-order queues on both sides (FIFO).
- Partial fills requeue encrypted remainder as a new head order for that side.
- Factory reuses wrapper token per underlying asset.
- `resolveMatch` is gateway-authorized (`onlyGateway`).
- For deterministic local integration tests, `DarkPoolEscrow` has `testingMode` and `submit*OrderTest(...)`.
