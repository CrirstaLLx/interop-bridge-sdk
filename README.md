# bridge-sdk

A unified cross-chain bridge SDK that wraps **Axelar** and **Wormhole** protocols behind a single, consistent API. Built as part of a bachelor's thesis on blockchain interoperability.

Adding a new protocol in the future = implementing one interface. Nothing else changes.

---

## Installation

```bash
npm install bridge-sdk
```

**Requirements:** Node.js >= 18.0.0

---

## Quick start

```ts
import { ethers } from "ethers";
import { BridgeSDK, AxelarAdapter, WormholeAdapter } from "bridge-sdk";

// 1. Create a signer (from your wallet / private key)
const provider = new ethers.JsonRpcProvider(YOUR_RPC_URL);
const signer   = new ethers.Wallet(YOUR_PRIVATE_KEY, provider);

// 2. Register protocols
const sdk = new BridgeSDK()
  .register("axelar",   new AxelarAdapter(signer))
  .register("wormhole", new WormholeAdapter(YOUR_PRIVATE_KEY));

// 3. Transfer
const result = await sdk.transfer("axelar", {
  fromChain: "ethereum-sepolia",
  toChain:   "optimism-sepolia",
  token:     "0xUSDC_ADDRESS",
  amount:    "1.0",
  decimals:  6,
  extra: {
    sourceContractAddress:      "0xYOUR_SOURCE_CONTRACT",
    destinationContractAddress: "0xYOUR_DEST_CONTRACT",
    tokenSymbol:                "aUSDC",
    tokenAddress:               "0xUSDC_ADDRESS",
    gasFee:                     "0.0002",
  },
});

console.log("TX:", result.sourceTx);
```

---

## Supported protocols

| Protocol | Mode | Chains |
|----------|------|--------|
| Axelar   | Automatic (relayer) | Arbitrum, Avalanche, Base, BNB Chain, Blast, Ethereum, Fantom, Filecoin, Fraxtal, Immutable, Linea, Mantle, Moonbase, Optimism, Polygon, Scroll, Celo, Kava |
| Wormhole | Manual (TokenBridge) or Automatic | Ethereum, BSC, Polygon, Avalanche, Fantom, Celo, Moonbeam, Injective, Sui, Aptos, Arbitrum, Optimism, Base, Sei, Scroll, Blast, X Layer |

**Chains supported by both protocols** (usable as intermediate hops in multi-hop transfers): Arbitrum, Avalanche, Base, Fantom, Optimism, Polygon, Scroll, Celo

---

## API

### `BridgeSDK`

```ts
const sdk = new BridgeSDK();
```

#### `.register(name, adapter)`
Register a protocol adapter. Returns `this` for chaining.

```ts
sdk.register("axelar", new AxelarAdapter(signer));
```

#### `.use(name)`
Get a registered adapter by name.

```ts
sdk.use("axelar").transfer(req);
```

#### `.protocols()`
List all registered protocol names.

```ts
sdk.protocols(); // → ["axelar", "wormhole"]
```

#### `.transfer(protocol, req)`
Execute a cross-chain token transfer.

```ts
const result = await sdk.transfer("wormhole", req);
```

#### `.estimateAll(req)`
Estimate fees across all registered protocols in parallel. Useful for comparing costs.

```ts
const estimates = await sdk.estimateAll(req);
// → [{ protocol: "axelar", estimate: { fee: "0.0001", feeToken: "ETH" } }, ...]
```

#### `.multiHop(hops)`
Execute a multi-hop transfer across multiple protocols. Automatically waits for each hop to complete before starting the next.

```ts
const result = await sdk.multiHop([
  {
    protocol: "wormhole",
    req: { fromChain: "PolygonSepolia", toChain: "ArbitrumSepolia", ... },
  },
  {
    protocol: "axelar",
    req: { fromChain: "arbitrum-sepolia", toChain: "optimism-sepolia", ... },
  },
]);
```

---

## TransferRequest

```ts
interface TransferRequest {
  fromChain: string;       // source chain name
  toChain:   string;       // destination chain name
  token:     string;       // token address
  amount:    string;       // human-readable amount, e.g. "1.5"
  decimals:  number;       // token decimals, e.g. 6 for USDC
  recipient?: string;      // optional recipient (defaults to sender)
  extra?:    Record<string, unknown>; // protocol-specific config
}
```

---

## Protocol-specific `extra` fields

### Axelar

```ts
extra: {
  sourceContractAddress:      string;  // your deployed Axelar GMP contract on source chain
  destinationContractAddress: string;  // your deployed Axelar GMP contract on dest chain
  tokenSymbol:                string;  // Axelar token symbol, e.g. "aUSDC"
  gasFee:                     string;  // ETH amount for relay gas, e.g. "0.0002"
  tokenAddress?:              string;  // if provided, auto-approve is run before transfer
  recipients?:                string[]; // optional list of recipient addresses
}
```

> **Note:** Axelar requires a deployed GMP contract on both source and destination chains.
> Deploy the [Axelar example contract](https://docs.axelar.dev/dev/general-message-passing/gmp-messages) before using this adapter.

### Wormhole

```ts
extra: {
  protocol?:      "TokenBridge" | "AutomaticTokenBridge"; // default: "TokenBridge"
  ensureWrapped?: boolean; // auto-attest token if not wrapped on destination (default: true)
}
```

- `TokenBridge` — manual relay, SDK completes the destination transaction. Safe to use as an intermediate hop in `multiHop()`.
- `AutomaticTokenBridge` — relayer completes delivery automatically. **Cannot be used as an intermediate hop.**

---

## Multi-hop transfers

Multi-hop allows bridging between chains that are not supported by a single protocol, using a shared intermediate chain.

**Example:** A chain only on Wormhole → intermediate chain (on both) → a chain only on Axelar

```
Polygon Sepolia → (Wormhole) → Arbitrum Sepolia → (Axelar) → Optimism Sepolia
```

```ts
const result = await sdk.multiHop([
  {
    protocol: "wormhole",
    req: {
      fromChain: "PolygonSepolia",
      toChain:   "ArbitrumSepolia",
      token:     "0xUSDC_ON_POLYGON",
      amount:    "0.01",
      decimals:  6,
      extra: {
        protocol:      "TokenBridge",
        ensureWrapped: true,
      },
    },
  },
  {
    protocol: "axelar",
    req: {
      fromChain: "arbitrum-sepolia",
      toChain:   "optimism-sepolia",
      token:     "0xAUSDC_ON_ARBITRUM",
      amount:    "0.01",
      decimals:  6,
      extra: {
        sourceContractAddress:      "0xYOUR_ARBITRUM_CONTRACT",
        destinationContractAddress: "0xYOUR_OP_CONTRACT",
        tokenSymbol:                "aUSDC",
        tokenAddress:               "0xAUSDC_ON_ARBITRUM",
        gasFee:                     "0.0002",
      },
    },
  },
]);
```

**How waiting between hops works:**
- **Wormhole TokenBridge** — synchronous, SDK waits for destination TX confirmation before starting next hop
- **Axelar** — asynchronous, SDK polls Axelarscan every 15s until `destination_executed`

---

## Adding a new protocol

Implement `IBridgeAdapter` and register it:

```ts
import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "bridge-sdk";

class LayerZeroAdapter implements IBridgeAdapter {
  readonly protocolName = "layerzero";

  async estimateFee(req: TransferRequest): Promise<FeeEstimate> {
    // ...
  }

  async transfer(req: TransferRequest): Promise<TransferResult> {
    // ...
  }
}

sdk.register("layerzero", new LayerZeroAdapter(...));
const result = await sdk.transfer("layerzero", req);
```

No changes to `BridgeSDK` or any other adapter are needed.

---

## Token notes

- **Axelar** uses `aUSDC` — its own wrapped USDC issued on each supported chain
- **Wormhole** wraps tokens as `wormhole-wrapped` versions on the destination chain
- In a multi-hop scenario where Wormhole delivers `wUSDC` and the next hop requires `aUSDC`, a DEX swap between hops would be needed in production

---

## License

ISC
