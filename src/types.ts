// ─────────────────────────────────────────────────────────────────────────────
// types.ts  –  Shared contracts for the Bridge SDK
// Every protocol adapter must implement IBridgeAdapter.
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Unified transfer request – protocol-agnostic
// ---------------------------------------------------------------------------
export interface TransferRequest {
  /** Chain name on the source side (e.g. "ethereum-sepolia", "Ethereum") */
  fromChain: string;

  /** Chain name on the destination side (e.g. "avalanche", "Solana") */
  toChain: string;

  /** Token address or well-known symbol (e.g. "0xabc…" or "aUSDC") */
  token: string;

  /** Human-readable amount, e.g. "1.5" */
  amount: string;

  /** Token decimals – required so adapters can parse amounts correctly */
  decimals: number;

  /** Where tokens should land on the destination chain (defaults to sender) */
  recipient?: string;

  /**
   * Protocol-specific extras.
   * Axelar example:  { sourceContractAddress, destinationContractAddress, tokenSymbol, gasFee }
   * Wormhole example: { protocol: "AutomaticTokenBridge", ensureWrapped: true }
   */
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Unified fee estimate result
// ---------------------------------------------------------------------------
export interface FeeEstimate {
  /** Protocol that produced this estimate */
  protocol: string;

  /** Fee amount as a human-readable string (e.g. "0.0012") */
  fee: string;

  /** Native token used to pay the fee (e.g. "ETH", "AVAX") */
  feeToken: string;

  /** Raw response from the underlying SDK – useful for debugging */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Unified transfer result
// ---------------------------------------------------------------------------
export interface TransferResult {
  /** Protocol that executed the transfer */
  protocol: string;

  /** Transaction hash(es) on the source chain */
  sourceTx: string | string[];

  /** Transaction hash(es) on the destination chain (null for automatic relays) */
  destinationTx?: string | string[] | null;

  /** "automatic" = relayer completes it, "manual" = SDK completed it */
  mode: "automatic" | "manual";

  /** Raw response from the underlying SDK */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// The interface every adapter MUST implement
// Adding a new protocol = implementing this interface, nothing else changes.
// ---------------------------------------------------------------------------
export interface IBridgeAdapter {
  /** Human-readable protocol name, e.g. "axelar" or "wormhole" */
  readonly protocolName: string;

  /** Estimate cross-chain fee without sending a transaction */
  estimateFee(req: TransferRequest): Promise<FeeEstimate>;

  /** Execute a cross-chain token transfer */
  transfer(req: TransferRequest): Promise<TransferResult>;
}