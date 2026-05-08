# ShadowPool Contracts (FHEVM)

This workspace contains the Solidity implementation for:

- `DarkPoolToken.sol`: confidential ERC-7984 wrapper token.
- `DarkPoolEscrow.sol`: encrypted order intake, queueing, and escrow.
- `DarkPoolMatcher.sol`: encrypted matching + proof-verified callback resolution.
- `DarkPoolSettlement.sol`: confidential settlement transfers.
- `DarkPoolFactory.sol`: modular pair factory coordinator.
- `DarkPoolWrapperDeployer.sol`: wrapper deploy helper owned by factory.
- `DarkPoolPairDeployer.sol`: escrow/matcher/settlement deploy helper owned by factory.

## Local setup

```bash
cd contracts
npm install
npm run build
npm test
```

## Deploy (modular factory)

```bash
cd contracts
OWNER_ADDRESS=0x... GATEWAY_ADDRESS=0x... npm run deploy:local
SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=... OWNER_ADDRESS=0x... GATEWAY_ADDRESS=0x... npm run deploy:sepolia
```

## Create pairs

Use factory scripts to create and inspect pairs:

- `scripts/factory-create-pairs-sepolia.ts`
- `scripts/factory-create-sweth-susdc.ts`
- `scripts/factory-dump-state-sepolia.ts`

## Frontend integration

1. Read pair addresses from `DarkPoolFactory.getPair(tokenA, tokenB)`.
2. Submit encrypted orders to returned `escrow`.
3. Watch events:
- `SellOrderSubmitted`
- `BuyOrderSubmitted`
- `MatchTriggered`
- `PartialFill`
- `MatchResolved`

## Notes

- Pair supports multi-order queues on both sides (FIFO).
- Partial fills requeue encrypted remainder at queue head for the remaining side.
- `resolveMatchWithProof` enforces decryption proof verification (`FHE.checkSignatures`).
