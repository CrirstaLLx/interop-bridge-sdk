// ─────────────────────────────────────────────────────────────────────────────
// wormhole/WormholeAdapter.ts  –  Wraps WormholeBridge to implement IBridgeAdapter
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";
import { Chain } from "@wormhole-foundation/sdk";
import { WormholeBridge, ExecutorEstimate } from "./WormholeBridge";
import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "../types";
import { getNativeToken } from "../chains";

// ---------------------------------------------------------------------------
// Wormhole-specific extras (passed via req.extra)
// ---------------------------------------------------------------------------
export interface WormholeExtra {
  /**
   * Which Wormhole protocol to use:
   *
   * "ExecutorTokenBridge"  — executor pays destination, precise fee estimate.
   *                          DEFAULT — recommended for fee estimation.
   *
   * "TokenBridge"          — manual, user pays gas on both chains.
   * "AutomaticTokenBridge" — relayer pays destination (mainnet only).
   */
  protocol?: "TokenBridge" | "AutomaticTokenBridge" | "ExecutorTokenBridge";

  /** Auto-attest token on destination if not wrapped yet. Default: true */
  ensureWrapped?: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export class WormholeAdapter implements IBridgeAdapter {
  readonly protocolName = "wormhole";

  private bridge:      WormholeBridge;
  private privateKey:  string;
  private provider?:   ethers.Provider;
  private initialized = false;

  constructor(privateKey: string, provider?: ethers.Provider) {
    this.privateKey = privateKey;
    this.provider   = provider;
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

  /**
   * Estimate source chain gas cost (approve + initiateTransfer).
   * approx 180k gas units.
   */
  private async estimateSourceGas(chain: string): Promise<string> {
    if (!this.provider) return "0";
    try {
      const feeData  = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? ethers.parseUnits("20", "gwei");
      const cost     = BigInt(180_000) * gasPrice;
      return ethers.formatEther(cost);
    } catch {
      return "0";
    }
  }

  // ── IBridgeAdapter ─────────────────────────────────────────────────────────

  async estimateFee(req: TransferRequest): Promise<FeeEstimate> {
    await this.ensureInitialized();
    const extra    = this.parseExtra(req);
    const protocol = extra.protocol ?? "ExecutorTokenBridge";

    // ── ExecutorTokenBridge — precise relay fee from quote ────────────────
    if (protocol === "ExecutorTokenBridge") {
      const result = await this.bridge.estimate({
        from:          this.toWormholeChain(req.fromChain),
        to:            this.toWormholeChain(req.toChain),
        token:         req.token,
        amount:        req.amount,
        privateKey:    this.privateKey,
        protocol:      "ExecutorTokenBridge",
        ensureWrapped: extra.ensureWrapped,
      }) as ExecutorEstimate;

      // relayFeeWei = the "Amount Paid" shown on Wormholescan
      // This is what the executor charges to deliver tokens on the destination chain.
      // Formula from Wormhole Docs:
      //   relayFee = baseFee + (gasLimit * dstGasPrice * srcPrice / dstPrice)
      // The SDK computes this in quote.relayFee.amount — we use it directly.
      const relayFeeEth  = ethers.formatEther(result.relayFeeWei);
      const sourceGasEth = await this.estimateSourceGas(req.fromChain);
      const sourceToken  = getNativeToken(req.fromChain);

      console.log(`[WormholeAdapter] ExecutorTokenBridge fee breakdown:`);
      console.log(`  Source gas (approve+init) : ${sourceGasEth} ${sourceToken}`);
      console.log(`  Relay fee (Amount Paid)   : ${relayFeeEth} ${sourceToken}`);
      console.log(`  gasLimit (dest execution) : ${result.gasLimit}`);

      return {
        protocol:  this.protocolName,
        fee:       relayFeeEth,
        feeToken:  sourceToken,
        sourceCost: {
          amount: sourceGasEth,
          token:  sourceToken,
          chain:  req.fromChain,
        },
        destinationCost: {
          // relay fee = what executor charges = Amount Paid on Wormholescan
          amount: relayFeeEth,
          token:  sourceToken,
          chain:  req.toChain,
        },
        executor: {
          msgValue: result.msgValue.toString(),
          gasLimit: result.gasLimit.toString(),
        },
        raw: result,
      };
    }

    // ── AutomaticTokenBridge ──────────────────────────────────────────────
    if (protocol === "AutomaticTokenBridge") {
      const quote = await this.bridge.estimate({
        from:          this.toWormholeChain(req.fromChain),
        to:            this.toWormholeChain(req.toChain),
        token:         req.token,
        amount:        req.amount,
        privateKey:    this.privateKey,
        protocol:      "AutomaticTokenBridge",
        ensureWrapped: extra.ensureWrapped,
      }) as any;

      const feeAmount = quote?.relayFee?.amount ?? quote?.fee?.amount ?? "0";

      return {
        protocol:  this.protocolName,
        fee:       feeAmount.toString(),
        feeToken:  getNativeToken(req.fromChain),
        raw:       quote,
      };
    }

    // ── TokenBridge — no relay fee ────────────────────────────────────────
    return {
      protocol:  this.protocolName,
      fee:       "0",
      feeToken:  getNativeToken(req.fromChain),
      raw: {
        note: "TokenBridge has no relay fee. Use ExecutorTokenBridge for a fee estimate.",
      },
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

    // Extract real EVM hashes (bridge tx first, approve tx last if present)
    const sourceTx      = this.normalizeTxList(result.sourceTx);
    const destinationTx = result.destinationTx
      ? this.normalizeTxList(result.destinationTx)
      : null;

    return {
      protocol:      this.protocolName,
      sourceTx,
      destinationTx,
      mode:          result.mode === "automatic" ? "automatic" : "manual",
      raw:           result,
    };
  }

  /**
   * Normalise tx list — WormholeBridge returns string[] of raw txids.
   * Bridge tx is put first so sourceTx[0] always points to the trackable TX.
   */
  private normalizeTxList(raw: unknown): string[] {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const hashes = arr.map((t: any) => {
      const txid: string = typeof t === "string" ? t : t?.txid ?? String(t);
      return this.extractEvmHash(txid);
    });
    if (hashes.length > 1) {
      return [hashes[hashes.length - 1], ...hashes.slice(0, -1)];
    }
    return hashes;
  }

  private extractEvmHash(txid: string): string {
    if (!txid) return txid;
    const clean = txid.startsWith("0x") ? txid : `0x${txid}`;
    if (clean.length === 66) return clean;
    if (clean.length > 66) {
      const embedded = `0x${clean.slice(-64)}`;
      if (!/^0x0+$/.test(embedded)) return embedded;
    }
    return clean;
  }
}