// ─────────────────────────────────────────────────────────────────────────────
// sdk.ts  –  BridgeSDK  –  The single entry-point of the package
// ─────────────────────────────────────────────────────────────────────────────

import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "./types";
import { AxelarGMPRecoveryAPI, Environment } from "@axelar-network/axelarjs-sdk";

// ── Multi-hop types ───────────────────────────────────────────────────────────

export interface HopRequest {
  protocol: string;
  req: TransferRequest;
}

export interface MultiHopResult {
  hops: TransferResult[];
  success: boolean;
}

// ── BridgeSDK ─────────────────────────────────────────────────────────────────

export class BridgeSDK {
  private adapters = new Map<string, IBridgeAdapter>();

  // ── Registry ───────────────────────────────────────────────────────────────

  register(name: string, adapter: IBridgeAdapter): this {
    if (this.adapters.has(name)) {
      console.warn(`[BridgeSDK] Overwriting existing adapter: "${name}"`);
    }
    this.adapters.set(name, adapter);
    return this;
  }

  unregister(name: string): this {
    this.adapters.delete(name);
    return this;
  }

  use(name: string): IBridgeAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      const available = [...this.adapters.keys()].join(", ") || "none";
      throw new Error(
        `[BridgeSDK] Protocol "${name}" is not registered. ` +
        `Available protocols: ${available}`
      );
    }
    return adapter;
  }

  protocols(): string[] {
    return [...this.adapters.keys()];
  }

  // ── Single transfer ────────────────────────────────────────────────────────

  async transfer(protocol: string, req: TransferRequest): Promise<TransferResult> {
    return this.use(protocol).transfer(req);
  }

  // ── Fee helpers ────────────────────────────────────────────────────────────

  async estimateAll(
    req: TransferRequest
  ): Promise<Array<{ protocol: string; estimate: FeeEstimate | null; error?: string }>> {
    const entries = [...this.adapters.entries()];
    const results = await Promise.allSettled(
      entries.map(([, adapter]) => adapter.estimateFee(req))
    );
    return results.map((result, i) => {
      const protocol = entries[i][0];
      if (result.status === "fulfilled") {
        return { protocol, estimate: result.value };
      }
      return {
        protocol,
        estimate: null,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });
  }

  // ── Axelar status polling ──────────────────────────────────────────────────

  /**
   * Polls Axelarscan until the transaction reaches "destination_executed".
   * Used internally by multiHop() when Axelar is not the last hop.
   *
   * @param txHash     Source TX hash from Axelar transfer result
   * @param timeoutMs  How long to wait before giving up (default: 10 minutes)
   * @param intervalMs How often to check (default: 15 seconds)
   */
  async waitForAxelar(
    txHash: string,
    timeoutMs = 10 * 60 * 1000,
    intervalMs = 15_000
  ): Promise<void> {
    const api = new AxelarGMPRecoveryAPI({ environment: Environment.TESTNET });

    const start = Date.now();
    let attempt = 0;

    console.log(`[BridgeSDK] Waiting for Axelar relay: ${txHash}`);
    console.log(`[BridgeSDK] Track: https://testnet.axelarscan.io/gmp/${txHash}`);

    while (Date.now() - start < timeoutMs) {
      attempt++;
      const status = await api.queryTransactionStatus(txHash);
      const elapsed = Math.round((Date.now() - start) / 1000);

      console.log(
        `[BridgeSDK] Axelar status [${attempt}] (${elapsed}s): ${status.status}`
      );

      if (status.status === "destination_executed") {
        console.log(`[BridgeSDK] ✅ Axelar relay complete after ${elapsed}s`);
        return;
      }

      if (status.status === "insufficient_fee") {
        throw new Error(
          `[BridgeSDK] Axelar relay failed: insufficient_fee for ${txHash}. ` +
          `Use AxelarBridge.recover() to add gas.`
        );
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(
      `[BridgeSDK] Axelar relay timed out after ${timeoutMs / 1000}s for ${txHash}`
    );
  }

  // ── Multi-hop transfer ─────────────────────────────────────────────────────

  /**
   * Execute a multi-hop cross-chain transfer across multiple protocols.
   *
   * How waiting between hops works:
   *
   * - Wormhole TokenBridge (manual):
   *     Synchronous — when transfer() returns, destinationTx is confirmed
   *     and tokens have arrived. Next hop starts immediately.
   *
   * - Axelar (automatic):
   *     Asynchronous — we poll Axelarscan every 15s until
   *     status === "destination_executed", then start next hop.
   *
   * - Wormhole AutomaticTokenBridge as intermediate hop:
   *     Not supported — throws an error. Use TokenBridge instead.
   *
   * Example — Wormhole then Axelar:
   *
   *   const result = await sdk.multiHop([
   *     {
   *       protocol: "wormhole",
   *       req: {
   *         fromChain: "Sepolia",
   *         toChain:   "Ethereum",
   *         token:     "0xUSDC...",
   *         amount:    "1.0",
   *         decimals:  6,
   *         extra: { protocol: "TokenBridge", ensureWrapped: true },
   *       },
   *     },
   *     {
   *       protocol: "axelar",
   *       req: {
   *         fromChain: "ethereum-sepolia",
   *         toChain:   "filecoin-2",
   *         token:     "0xUSDC...",
   *         amount:    "1.0",
   *         decimals:  6,
   *         extra: {
   *           sourceContractAddress:      "0x...",
   *           destinationContractAddress: "0x...",
   *           tokenSymbol:                "aUSDC",
   *           gasFee:                     "0.005",
   *         },
   *       },
   *     },
   *   ]);
   */
  async multiHop(
    hops: HopRequest[],
    options: {
      axelarTimeoutMs?: number;   // default: 10 minutes
      axelarIntervalMs?: number;  // default: 15 seconds
    } = {}
  ): Promise<MultiHopResult> {
    if (hops.length < 2) {
      throw new Error("[BridgeSDK] multiHop requires at least 2 hops");
    }

    const results: TransferResult[] = [];

    for (let i = 0; i < hops.length; i++) {
      const { protocol, req } = hops[i];
      const isLastHop = i === hops.length - 1;

      console.log(
        `\n[BridgeSDK] ── Hop ${i + 1}/${hops.length} via ${protocol.toUpperCase()} ──`
      );
      console.log(`[BridgeSDK] ${req.fromChain} → ${req.toChain}`);

      const result = await this.transfer(protocol, req);
      results.push(result);

      console.log(`[BridgeSDK] Hop ${i + 1} source TX:`, result.sourceTx);

      // No waiting needed after the last hop
      if (isLastHop) break;

      // ── Wait for tokens to arrive before starting next hop ────────────────

      if (protocol === "wormhole" && result.mode === "manual") {
        // Wormhole TokenBridge (manual) is fully synchronous —
        // transfer() only returns after destinationTx is confirmed on chain.
        // Tokens are already on the intermediate chain → start next hop now.
        console.log(
          `[BridgeSDK] ✅ Wormhole manual relay complete — destination TX: ${result.destinationTx}`
        );

      } else if (protocol === "axelar") {
        // Axelar is fire-and-forget (mode: "automatic") —
        // the relayer delivers tokens asynchronously.
        // We poll Axelarscan until status === "destination_executed".
        const txHash = Array.isArray(result.sourceTx)
          ? result.sourceTx[0]
          : result.sourceTx;

        await this.waitForAxelar(
          txHash,
          options.axelarTimeoutMs,
          options.axelarIntervalMs
        );

      } else if (protocol === "wormhole" && result.mode === "automatic") {
        // AutomaticTokenBridge as an intermediate hop is not supported —
        // there is no on-chain confirmation we can wait for reliably.
        throw new Error(
          `[BridgeSDK] Wormhole AutomaticTokenBridge cannot be used as an ` +
          `intermediate hop (hop ${i + 1}). ` +
          `Set extra.protocol = "TokenBridge" instead.`
        );

      } else {
        console.warn(
          `[BridgeSDK] ⚠️  Unknown wait strategy for protocol "${protocol}" ` +
          `as intermediate hop — skipping wait. Tokens may not have arrived yet.`
        );
      }
    }

    console.log("\n[BridgeSDK] 🎉 All hops complete!");
    return { hops: results, success: true };
  }
}