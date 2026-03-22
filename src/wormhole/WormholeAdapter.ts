// ─────────────────────────────────────────────────────────────────────────────
// wormhole/WormholeAdapter.ts  –  Wraps WormholeBridge to implement IBridgeAdapter
// ─────────────────────────────────────────────────────────────────────────────

import { Chain } from "@wormhole-foundation/sdk";
import { WormholeBridge } from "./WormholeBridge";
import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "../types";

// ---------------------------------------------------------------------------
// Wormhole-specific extras (passed via req.extra)
// ---------------------------------------------------------------------------
export interface WormholeExtra {
  /**
   * Which Wormhole protocol to use.
   * "TokenBridge"          = manual relay — SDK completes destination tx
   * "AutomaticTokenBridge" = relayer pays & completes destination automatically
   * Default: "TokenBridge"
   */
  protocol?: "TokenBridge" | "AutomaticTokenBridge";

  /**
   * Auto-attest token on destination if not wrapped yet.
   * Default: true
   */
  ensureWrapped?: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export class WormholeAdapter implements IBridgeAdapter {
  readonly protocolName = "wormhole";

  private bridge:      WormholeBridge;
  private privateKey:  string;
  private initialized = false;

  /**
   * @param privateKey  EVM private key used to sign transactions.
   *                    The caller sources this securely (env var, KMS, wallet).
   */
  constructor(privateKey: string) {
    this.privateKey = privateKey;
    this.bridge     = new WormholeBridge();
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.bridge.init();
      this.initialized = true;
    }
  }

  private toWormholeChain(chain: string): Chain {
    return chain as Chain;
  }

  private parseExtra(req: TransferRequest): WormholeExtra {
    return (req.extra ?? {}) as WormholeExtra;
  }

  // ── IBridgeAdapter ─────────────────────────────────────────────────────────

  async estimateFee(req: TransferRequest): Promise<FeeEstimate> {
    await this.ensureInitialized();
    const extra = this.parseExtra(req);

    const quote = await this.bridge.estimate({
      from:          this.toWormholeChain(req.fromChain),
      to:            this.toWormholeChain(req.toChain),
      token:         req.token,
      amount:        req.amount,
      privateKey:    this.privateKey,
      protocol:      extra.protocol,
      ensureWrapped: extra.ensureWrapped,
    });

    const feeAmount =
      (quote as any)?.relayFee?.amount ??
      (quote as any)?.fee?.amount ??
      "0";

    return {
      protocol:  this.protocolName,
      fee:       feeAmount.toString(),
      feeToken:  req.fromChain,
      raw:       quote,
    };
  }

  async transfer(req: TransferRequest): Promise<TransferResult> {
    await this.ensureInitialized();
    const extra = this.parseExtra(req);

    const result = await this.bridge.transfer({
      from:          this.toWormholeChain(req.fromChain),
      to:            this.toWormholeChain(req.toChain),
      token:         req.token,
      amount:        req.amount,
      privateKey:    this.privateKey,
      protocol:      extra.protocol,
      ensureWrapped: extra.ensureWrapped,
    });

    // Normalise source TX — WormholeBridge returns string[]
    const sourceTx = Array.isArray(result.sourceTx)
      ? result.sourceTx.map((t: any) => (typeof t === "string" ? t : t?.txid ?? String(t)))
      : [String(result.sourceTx)];

    const destinationTx = result.destinationTx
      ? (Array.isArray(result.destinationTx)
          ? result.destinationTx.map((t: any) => (typeof t === "string" ? t : t?.txid ?? String(t)))
          : [String(result.destinationTx)])
      : null;

    return {
      protocol:      this.protocolName,
      sourceTx,
      destinationTx,
      mode:          result.mode === "automatic" ? "automatic" : "manual",
      raw:           result,
    };
  }
}