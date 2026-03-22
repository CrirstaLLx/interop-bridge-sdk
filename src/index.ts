// ─────────────────────────────────────────────────────────────────────────────
// index.ts  –  Public API of the bridge-sdk npm package
//
// Only export what consumers need.
// Internal helpers (AxelarBridge, WormholeBridge, etc.) stay private.
// ─────────────────────────────────────────────────────────────────────────────

// Core SDK
export { BridgeSDK } from "./sdk";

// Adapters (consumers import these to register protocols)
export { AxelarAdapter }   from "./axelar/AxelarAdapter";
export { WormholeAdapter } from "./wormhole/WormholeAdapter";

// Types (consumers need these to type their TransferRequest / results)
export type {
  IBridgeAdapter,
  TransferRequest,
  FeeEstimate,
  TransferResult,
} from "./types";

// Adapter-specific extras (optional – only needed for typed extra fields)
export type { AxelarExtra }   from "./axelar/AxelarAdapter";
export type { WormholeExtra } from "./wormhole/WormholeAdapter";