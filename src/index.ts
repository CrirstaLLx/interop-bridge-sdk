// ─────────────────────────────────────────────────────────────────────────────
// index.ts  –  Public API of the interop-bridge-sdk package
// ─────────────────────────────────────────────────────────────────────────────

export { BridgeSDK } from "./sdk";
export type { SendTransferParams, SendTransferResult, HopRequest, MultiHopResult } from "./sdk";

export { RouteSelector } from "./RouteSelector";
export type { RouteEstimate, RouteSelection } from "./RouteSelector";

export { AxelarAdapter }   from "./axelar/AxelarAdapter";
export { WormholeAdapter } from "./wormhole/WormholeAdapter";

export type {
  IBridgeAdapter,
  TransferRequest,
  FeeEstimate,
  TransferResult,
} from "./types";

export type { AxelarExtra }   from "./axelar/AxelarAdapter";
export type { WormholeExtra } from "./wormhole/WormholeAdapter";