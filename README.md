# interop-bridge-sdk

A unified cross-chain bridge SDK that wraps **Axelar** and **Wormhole** protocols behind a single, consistent API. Built as part of a bachelor's thesis on blockchain interoperability.

Adding a new protocol in the future = implementing one interface. Nothing else changes.

---

## Installation

```bash
npm install interop-bridge-sdk
```

**Requirements:** Node.js >= 18.0.0

---

## Quick start

```ts
import { ethers } from "ethers";
import { BridgeSDK, AxelarAdapter, WormholeAdapter } from "interop-bridge-sdk";

// 1. Create a signer for Axelar (requires ethers Wallet)
const provider = new ethers.JsonRpcProvider(YOUR_RPC_URL);
const signer   = new ethers.Wallet(YOUR_PRIVATE_KEY, provider);

// 2. Register protocols
const sdk = new BridgeSDK()
  .register("axelar",   new AxelarAdapter(signer))
  .register("wormhole", new WormholeAdapter(YOUR_PRIVATE_KEY));

// 3. Let the SDK pick the best protocol and route automatically
const result = await sdk.sendTransfer({
  fromChain: "ethereum-sepolia",
  toChain:   "optimism-sepolia",
  token:     "0xUSDC_ADDRESS",
  amount:    "1.0",
  decimals:  6,
});

console.log("Protocol used:", result.protocol);
console.log("Route:", result.routeDescription);
console.log("TX:", (result.result as any).sourceTx);
```

---

## Supported chains

### Axelar (testnet)

Arbitrum Sepolia, Avalanche Fuji, Base Sepolia, BNB Chain, Blast Sepolia, Ethereum Sepolia, Fantom, Filecoin Calibration, Fraxtal, Immutable zkEVM, Kava, Linea Sepolia, Mantle Sepolia, Moonbase Alpha, Optimism Sepolia, Polygon Sepolia, Scroll, Celo Alfajores

### Wormhole (testnet)

Aptos, Arbitrum Sepolia, Avalanche Fuji, Base Sepolia, Blast, BNB Chain, Celo Alfajores, Ethereum Sepolia, Fantom, Injective, Kaia, Linea Sepolia, Mantle Sepolia, Moonbeam, Optimism Sepolia, Polygon Sepolia, Scroll, Sei, Sui, Unichain Sepolia, X Layer

### Hub chains (supported by both — used for multi-hop)

Ethereum Sepolia, Avalanche Fuji, Polygon Sepolia, Arbitrum Sepolia, Optimism Sepolia, Base Sepolia

---

## API

### `BridgeSDK`

```ts
const sdk = new BridgeSDK();
```

#### `.register(name, adapter)`
Register a protocol adapter. Returns `this` for chaining.

```ts
sdk.register("axelar",   new AxelarAdapter(signer));
sdk.register("wormhole", new WormholeAdapter(privateKey));
```

#### `.unregister(name)`
Remove a registered adapter.

```ts
sdk.unregister("axelar");
```

#### `.use(name)`
Get a registered adapter by name. Throws if not found.

```ts
sdk.use("axelar").transfer(req);
```

#### `.protocols()`
List all registered protocol names.

```ts
sdk.protocols(); // → ["axelar", "wormhole"]
```

#### `.sendTransfer(params)` ✨ recommended
**The main entry point.** The SDK automatically:
1. Checks which registered protocols support the route directly.
2. If multiple protocols support it — estimates fees and picks the cheapest.
3. If no single protocol covers the route — finds a 2-hop path via a shared hub chain and executes both hops in sequence.

```ts
const result = await sdk.sendTransfer({
  fromChain: "ethereum-sepolia",
  toChain:   "optimism-sepolia",
  token:     "0xUSDC_ADDRESS",
  amount:    "1.0",
  decimals:  6,
});
// result.protocol         → "axelar" | "wormhole" | "axelar + wormhole"
// result.routeType        → "direct" | "multi-hop"
// result.routeDescription → "ethereum-sepolia → optimism-sepolia via axelar"
// result.feeEstimate      → FeeEstimate used to select the protocol
// result.result           → TransferResult or MultiHopResult
```

Chains only reachable via one protocol are handled automatically via multi-hop:

```ts
// Injective is Wormhole-only — SDK routes via a hub chain automatically
const result = await sdk.sendTransfer({
  fromChain: "ethereum-sepolia",
  toChain:   "injective",
  token:     "0xUSDC_ADDRESS",
  amount:    "1.0",
  decimals:  6,
});
```

#### `.transfer(protocol, req)`
Execute a transfer directly using a specific protocol, bypassing automatic selection.

```ts
const result = await sdk.transfer("wormhole", req);
```

#### `.estimateAll(req)`
Estimate fees across all registered protocols in parallel. Useful for comparing costs before transferring.

```ts
const estimates = await sdk.estimateAll(req);
// → [{ protocol: "axelar", estimate: { fee: "0.0001", feeToken: "ETH" } }, ...]
```

#### `.multiHop(hops, options?)`
Execute a multi-hop transfer across multiple protocols. Automatically waits for each hop to complete before starting the next.

```ts
const result = await sdk.multiHop(
  [
    {
      protocol: "wormhole",
      req: { fromChain: "polygon-sepolia", toChain: "arbitrum-sepolia", ... },
    },
    {
      protocol: "axelar",
      req: { fromChain: "arbitrum-sepolia", toChain: "optimism-sepolia", ... },
    },
  ],
  {
    axelarTimeoutMs:  600_000, // default: 10 minutes
    axelarIntervalMs: 15_000,  // default: 15 seconds
  }
);
```

#### `.waitForAxelar(txHash, timeoutMs?, intervalMs?)`
Poll Axelarscan until a transaction reaches `destination_executed`. Used internally by `multiHop()`, but exposed for manual use.

```ts
await sdk.waitForAxelar("0xYOUR_TX_HASH");
```

---

## `RouteSelector`

A lower-level utility that analyses all viable routes for a transfer without executing anything. Useful for building UIs that let users preview and compare routes.

```ts
import { ethers } from "ethers";
import { BridgeSDK, RouteSelector } from "interop-bridge-sdk";

const selector = new RouteSelector(sdk, provider);

const selection = await selector.selectRoute(
  "ethereum-sepolia",  // fromChain
  "optimism-sepolia",  // toChain
  "0xUSDC_ADDRESS",    // token
  "1.0",               // amount
  6,                   // decimals
);

console.log("Recommended:", selection.recommended); // → "axelar" | "wormhole" | null
console.log("Reason:",      selection.reason);
console.log("Estimates:",   selection.estimates);   // RouteEstimate[]
```

`RouteSelector` also exposes `findMultiHopPath()` if you only want to discover routes without fee estimates:

```ts
const path = selector.findMultiHopPath(["axelar", "wormhole"], "ethereum-sepolia", "injective");
// path.found       → true
// path.description → "wormhole: ethereum-sepolia→avalanche + wormhole: avalanche→injective"
// path.hops        → [{ protocol, fromChain, toChain }, ...]
```

---

## TransferRequest

Used by `.transfer()` and `.multiHop()` when calling protocols directly.

```ts
interface TransferRequest {
  fromChain: string;                    // source chain canonical key (see chains.ts)
  toChain:   string;                    // destination chain canonical key
  token:     string;                    // token contract address on source chain
  amount:    string;                    // human-readable amount, e.g. "1.5"
  decimals:  number;                    // token decimals, e.g. 6 for USDC
  recipient?: string;                   // optional recipient (defaults to sender)
  extra?:    Record<string, unknown>;   // protocol-specific config (see below)
}
```

> When using `sendTransfer()`, chain keys and `extra` fields are resolved automatically from `chains.ts`. Manual `extra` is only needed when calling `.transfer()` directly.

---

## Protocol-specific `extra` fields

### Axelar

```ts
extra: {
  sourceContractAddress:      string;   // your deployed Axelar GMP contract on source chain
  destinationContractAddress: string;   // your deployed Axelar GMP contract on dest chain
  tokenSymbol:                string;   // Axelar token symbol, e.g. "aUSDC"
  gasFee:                     string;   // ETH amount for relay gas, e.g. "0.0002"
  tokenAddress?:              string;   // if provided, auto-approve is run before transfer
  recipients?:                string[]; // optional list of recipient addresses
}
```

> **Note:** Axelar requires a GMP contract deployed on both chains. Deploy the [Axelar example contract](https://docs.axelar.dev/dev/general-message-passing/gmp-messages) before using this adapter. Contract addresses for chains already configured in `chains.ts` are filled in automatically by `sendTransfer()`.

### Wormhole

```ts
extra: {
  protocol?:      "ExecutorTokenBridge"; // default and only recommended value
  ensureWrapped?: boolean;               // auto-attest token if not wrapped on destination (default: true)
}
```

- `ExecutorTokenBridge` — manual relay mode: the SDK completes the destination transaction and waits for confirmation. Safe to use as an intermediate hop in `multiHop()`.

> Automatic relayer mode (where a third-party relayer completes delivery) **cannot be used as an intermediate hop** in `multiHop()`.

---

## Multi-hop transfers

Multi-hop allows bridging between chains that are not directly supported by a single protocol, by routing through a shared hub chain.

**Example:** Polygon Sepolia (Wormhole only) → Arbitrum Sepolia (hub) → Optimism Sepolia (Axelar only)

```
polygon-sepolia → (Wormhole) → arbitrum-sepolia → (Axelar) → optimism-sepolia
```

The easiest way is `sendTransfer()` — it finds the path automatically. For manual control:

```ts
const result = await sdk.multiHop([
  {
    protocol: "wormhole",
    req: {
      fromChain: "polygon-sepolia",
      toChain:   "arbitrum-sepolia",
      token:     "0xUSDC_ON_POLYGON",
      amount:    "0.01",
      decimals:  6,
      extra: {
        protocol:      "ExecutorTokenBridge",
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
- **Wormhole (ExecutorTokenBridge)** — synchronous; SDK waits for destination TX confirmation before starting the next hop.
- **Axelar** — asynchronous; SDK polls Axelarscan every 15 s until `destination_executed`.

---

## Adding a new protocol

Implement `IBridgeAdapter` and register it:

```ts
import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "interop-bridge-sdk";

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

// sendTransfer() picks it up automatically alongside existing protocols
const result = await sdk.sendTransfer({ fromChain: "...", toChain: "...", ... });
```

No changes to `BridgeSDK`, `RouteSelector`, or any existing adapter are needed.

---

## Token notes

- **Axelar** uses `aUSDC` — its own wrapped USDC issued on each supported chain. Contract addresses are stored in `chains.ts` and resolved automatically.
- **Wormhole** uses Circle USDC on chains where it is available, and creates wormhole-wrapped tokens on chains where it is not. USDC addresses are stored in `chains.ts`.
- In a multi-hop scenario where Wormhole delivers `wUSDC` and the next Axelar hop expects `aUSDC`, a DEX swap between hops would be required in production.

---

## License

ISC