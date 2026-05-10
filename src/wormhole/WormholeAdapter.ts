// WormholeAdapter.ts — wraps WormholeBridge to implement IBridgeAdapter

import { ethers } from "ethers";
import { Chain } from "@wormhole-foundation/sdk";
import { WormholeBridge, ExecutorEstimate } from "./WormholeBridge";
import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "../types";
import { getNativeToken } from "../chains";

// Protocol-specific extras passed via req.extra.
export interface WormholeExtra {
  // Which sub-protocol to use:
  //   "ExecutorTokenBridge"  — executor pays destination gas, precise fee estimate available.
  //                            Default and recommended for sendTransfer().
  //   "TokenBridge"          — manual relay, SDK completes the dest TX. Use this for intermediate
  //                            hops in multiHop() — it's the only mode that waits synchronously.
  //   "AutomaticTokenBridge" — relayer handles destination (mainnet only, cannot be a hop).
  protocol?: "TokenBridge" | "AutomaticTokenBridge" | "ExecutorTokenBridge";

  ensureWrapped?: boolean; // auto-attest token on destination if not yet wrapped (default: true)
}

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

  // Source chain gas estimate for approve + initiateTransfer (~180k gas units).
  // Returns "0" if no provider was supplied — fee comparison still works, just less precise.
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

  async estimateFee(req: TransferRequest): Promise<FeeEstimate> {
    await this.ensureInitialized();
    const extra    = this.parseExtra(req);
    const protocol = extra.protocol ?? "ExecutorTokenBridge";

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

      // relayFeeWei = quote.relayFee.amount from the Wormhole SDK.
      // This is what the executor charges to deliver tokens on the destination chain,
      // and matches the "Amount Paid" field shown on Wormholescan.
      // Formula: baseFee + (gasLimit × dstGasPrice × srcPrice / dstPrice)
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

    // TokenBridge has no relay fee — user pays destination gas themselves.
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

  // WormholeBridge returns a string[] of raw txids. We put the bridge tx first
  // so sourceTx[0] always points to the trackable transaction (the one that
  // shows up on Wormholescan), regardless of how many txids were returned.
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

  // Wormhole occasionally returns txids with extra prefix bytes. If the clean
  // hex is longer than 32 bytes, pull the last 32 bytes — that's the EVM hash.
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