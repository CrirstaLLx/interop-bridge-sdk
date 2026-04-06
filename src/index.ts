// ─────────────────────────────────────────────────────────────────────────────
// index.ts  –  Public API of the bridge-sdk npm package
// ─────────────────────────────────────────────────────────────────────────────

// Core SDK
export { BridgeSDK } from "./sdk";

// Route selection
export { RouteSelector } from "./RouteSelector";
export type { RouteEstimate, RouteSelection } from "./RouteSelector";

// Adapters
export { AxelarAdapter }   from "./axelar/AxelarAdapter";
export { WormholeAdapter } from "./wormhole/WormholeAdapter";

// Types
export type {
  IBridgeAdapter,
  TransferRequest,
  FeeEstimate,
  TransferResult,
} from "./types";

// Adapter-specific extras
export type { AxelarExtra }   from "./axelar/AxelarAdapter";
export type { WormholeExtra } from "./wormhole/WormholeAdapter";