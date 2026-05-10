// sdk.ts — BridgeSDK, the single entry-point of the package

import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "./types";
import { AxelarGMPRecoveryAPI, Environment } from "@axelar-network/axelarjs-sdk";
import { ethers } from "ethers";

// ── Multi-hop types ───────────────────────────────────────────────────────────

export interface HopRequest {
  protocol: string;
  req: TransferRequest;
}

export interface MultiHopResult {
  hops: TransferResult[];
  success: boolean;
}

// sendTransfer() params — caller only needs to say what to move and where.
// The SDK works out which protocol(s) to use.
export interface SendTransferParams {
  fromChain: string;   // canonical key, e.g. "ethereum-sepolia"
  toChain:   string;   // canonical key, e.g. "optimism-sepolia"
  token:     string;   // token contract address on the source chain
  amount:    string;   // human-readable, e.g. "1.0"
  decimals:  number;
  extra?:    Record<string, unknown>;  // passed through to the adapter unchanged
  provider?: ethers.Provider;          // only needed for Wormhole gas estimation
}

export interface SendTransferResult {
  protocol:         string;
  routeType:        "direct" | "multi-hop";
  result:           TransferResult | MultiHopResult;
  feeEstimate?:     FeeEstimate | null;
  routeDescription: string;
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

  // ── High-level transfer ────────────────────────────────────────────────────

  // The smart entry-point. Caller specifies source/dest/token/amount; SDK handles routing:
  //
  //   1. Ask each registered adapter whether it can handle the route.
  //   2. If multiple can — estimate fees and pick the cheapest.
  //   3. If none can — look for a 2-hop path through a shared hub chain.
  //   4. Execute and return.
  async sendTransfer(params: SendTransferParams): Promise<SendTransferResult> {
    const { fromChain, toChain, token, amount, decimals, extra, provider } = params;
    const protocols = this.protocols();

    console.log(`\n[BridgeSDK] sendTransfer: ${fromChain} → ${toChain}`);

    const supported = this.findSupportedProtocols(fromChain, toChain);
    console.log(`[BridgeSDK] Supported directly: ${supported.length > 0 ? supported.join(", ") : "none"}`);

    if (supported.length > 0) {
      const estimates = await this.estimateFees(
        supported, fromChain, toChain, token, amount, decimals, extra
      );

      const best = estimates[0] ?? null; // sorted cheapest-first by estimateFees()

      if (best) {
        const fee = best.estimate.sourceCost
          ? `${best.estimate.sourceCost.amount} ${best.estimate.sourceCost.token} (source) + ${best.estimate.destinationCost?.amount ?? "0"} (relay)`
          : `${best.estimate.fee} ${best.estimate.feeToken}`;

        console.log(`[BridgeSDK] Selected: ${best.protocol} — fee: ${fee}`);

        if (supported.length > 1) {
          const other = estimates[1];
          console.log(`[BridgeSDK] Alternative: ${other?.protocol} — total: ${other?.totalCost?.toFixed(8)}`);
        }

        const req    = this.buildRequest(best.protocol, fromChain, toChain, token, amount, decimals, extra);
        const result = await this.transfer(best.protocol, req);

        return {
          protocol:         best.protocol,
          routeType:        "direct",
          result,
          feeEstimate:      best.estimate,
          routeDescription: `${fromChain} → ${toChain} via ${best.protocol}`,
        };
      }
    }

    // No single protocol covers both chains — try a 2-hop path via a hub.
    console.log(`[BridgeSDK] No direct route — searching for multi-hop path...`);

    const path = this.findMultiHopPath(protocols, fromChain, toChain);

    if (!path) {
      throw new Error(
        `[BridgeSDK] No route found from "${fromChain}" to "${toChain}". ` +
        `Registered protocols: ${protocols.join(", ") || "none"}`
      );
    }

    const { hub, hop1, hop2 } = path;
    console.log(`[BridgeSDK] Multi-hop: ${hop1.protocol}: ${fromChain}→${hub} + ${hop2.protocol}: ${hub}→${toChain}`);

    const multiHopResult = await this.multiHop([
      {
        protocol: hop1.protocol,
        req:      this.buildRequest(hop1.protocol, fromChain, hub, token, amount, decimals, extra),
      },
      {
        protocol: hop2.protocol,
        req:      this.buildRequest(hop2.protocol, hub, toChain, token, amount, decimals, extra),
      },
    ]);

    return {
      protocol:         `${hop1.protocol} + ${hop2.protocol}`,
      routeType:        "multi-hop",
      result:           multiHopResult,
      routeDescription: `${fromChain} → ${hub} (${hop1.protocol}) → ${toChain} (${hop2.protocol})`,
    };
  }

  // ── Helpers for sendTransfer ───────────────────────────────────────────────

  private findSupportedProtocols(fromChain: string, toChain: string): string[] {
    return this.protocols().filter((p) => this.canBuildRequest(p, fromChain, toChain));
  }

  private canBuildRequest(protocol: string, fromChain: string, toChain: string): boolean {
    try {
      this.buildRequest(protocol, fromChain, toChain, "", "0", 6);
      return true;
    } catch {
      return false;
    }
  }

  private async estimateFees(
    protocols: string[],
    fromChain: string,
    toChain:   string,
    token:     string,
    amount:    string,
    decimals:  number,
    extra?:    Record<string, unknown>
  ): Promise<Array<{ protocol: string; estimate: FeeEstimate; totalCost: number }>> {
    const results: Array<{ protocol: string; estimate: FeeEstimate; totalCost: number }> = [];

    for (const protocol of protocols) {
      try {
        const req      = this.buildRequest(protocol, fromChain, toChain, token, amount, decimals, extra);
        const estimate = await this.use(protocol).estimateFee(req);
        const total    = this.computeTotalCost(estimate);
        if (total !== null) {
          results.push({ protocol, estimate, totalCost: total });
          console.log(`[BridgeSDK] ${protocol} estimated total: ${total.toFixed(8)} ETH`);
        }
      } catch (err: any) {
        console.log(`[BridgeSDK] ${protocol} fee estimation failed: ${err.message}`);
      }
    }

    return results.sort((a, b) => a.totalCost - b.totalCost);
  }

  private computeTotalCost(estimate: FeeEstimate): number | null {
    try {
      const source = parseFloat(estimate.sourceCost?.amount ?? estimate.fee ?? "0");
      const dest   = parseFloat(estimate.destinationCost?.amount ?? "0");
      // Only add destination cost if both sides are denominated in the same token.
      // Cross-token addition would produce a meaningless number.
      const same   = !estimate.destinationCost ||
        estimate.sourceCost?.token === estimate.destinationCost?.token;
      return same ? source + dest : source;
    } catch {
      return null;
    }
  }

  private findMultiHopPath(
    protocols: string[],
    fromChain: string,
    toChain:   string
  ): { hub: string; hop1: { protocol: string }; hop2: { protocol: string } } | null {
    const { HUB_CHAINS } = require("./chains");

    // Try each hub in preference order (defined in chains.ts).
    // First valid combination wins — hop1 and hop2 can be different protocols.
    for (const hub of HUB_CHAINS as string[]) {
      if (hub === fromChain || hub === toChain) continue;
      for (const p1 of protocols) {
        if (!this.canBuildRequest(p1, fromChain, hub)) continue;
        for (const p2 of protocols) {
          if (!this.canBuildRequest(p2, hub, toChain)) continue;
          return { hub, hop1: { protocol: p1 }, hop2: { protocol: p2 } };
        }
      }
    }
    return null;
  }

  // Translate canonical chain keys into protocol-specific names and inject
  // the right token addresses and contract addresses from chains.ts.
  // Axelar uses aUSDC with its own symbol/address; Wormhole uses Circle USDC.
  private buildRequest(
    protocol:  string,
    fromChain: string,
    toChain:   string,
    token:     string,
    amount:    string,
    decimals:  number,
    extra?:    Record<string, unknown>
  ): TransferRequest {
    const {
      toWormholeName,
      toAxelarName,
      getChain,
      getAxelarUsdcAddress,
      getUsdcAddress,
    } = require("./chains");

    if (protocol === "wormhole") {
      const wFrom = toWormholeName(fromChain);
      const wTo   = toWormholeName(toChain);
      if (!wFrom || !wTo) throw new Error(`Wormhole: ${fromChain} → ${toChain} not supported`);
      return {
        fromChain: wFrom,
        toChain:   wTo,
        token:     getUsdcAddress(fromChain) ?? token,
        amount,
        decimals,
        extra: { protocol: "ExecutorTokenBridge", ensureWrapped: true, ...extra },
      };
    }

    if (protocol === "axelar") {
      const aFrom    = toAxelarName(fromChain);
      const aTo      = toAxelarName(toChain);
      const fromInfo = getChain(fromChain);
      const toInfo   = getChain(toChain);
      if (!aFrom || !aTo)                                throw new Error(`Axelar: ${fromChain} → ${toChain} not supported`);
      if (!fromInfo?.axelarContracts?.contractAddress)   throw new Error(`Axelar: no contract on ${fromChain}`);
      if (!toInfo?.axelarContracts?.contractAddress)     throw new Error(`Axelar: no contract on ${toChain}`);
      return {
        fromChain: aFrom,
        toChain:   aTo,
        token,
        amount,
        decimals,
        extra: {
          sourceContractAddress:      fromInfo.axelarContracts.contractAddress,
          destinationContractAddress: toInfo.axelarContracts.contractAddress,
          tokenSymbol:                fromInfo.axelarTokenSymbol ?? "aUSDC",
          tokenAddress:               getAxelarUsdcAddress(fromChain),
          gasFee:                     "0",
          ...extra,
        },
      };
    }

    return { fromChain, toChain, token, amount, decimals, extra };
  }

  // ── Single transfer ────────────────────────────────────────────────────────

  async transfer(protocol: string, req: TransferRequest): Promise<TransferResult> {
    return this.use(protocol).transfer(req);
  }

  // ── Fee helpers ────────────────────────────────────────────────────────────

  // Runs estimateFee() on all registered adapters in parallel.
  // Useful for showing users a cost comparison before they commit to a transfer.
  async estimateAll(
    req: TransferRequest
  ): Promise<Array<{ protocol: string; estimate: FeeEstimate | null; error?: string }>> {
    const entries = [...this.adapters.entries()];
    const results = await Promise.allSettled(
      entries.map(([, adapter]) => adapter.estimateFee(req))
    );
    return results.map((result, i) => {
      const protocol = entries[i][0];
      if (result.status === "fulfilled") return { protocol, estimate: result.value };
      return {
        protocol,
        estimate: null,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });
  }

  // ── Axelar status polling ──────────────────────────────────────────────────

  // Axelar transfers are async — the source TX lands immediately but the relayer
  // needs time to execute on the destination. This polls Axelarscan until
  // "destination_executed" or the timeout fires. Used between hops in multiHop()
  // and also exposed for manual polling after a standalone transfer.
  async waitForAxelar(
    txHash:    string,
    timeoutMs  = 10 * 60 * 1000,
    intervalMs = 15_000
  ): Promise<void> {
    const api   = new AxelarGMPRecoveryAPI({ environment: Environment.TESTNET });
    const start = Date.now();
    let attempt = 0;

    console.log(`[BridgeSDK] Waiting for Axelar relay: ${txHash}`);
    console.log(`[BridgeSDK] Track: https://testnet.axelarscan.io/gmp/${txHash}`);

    while (Date.now() - start < timeoutMs) {
      attempt++;
      const status  = await api.queryTransactionStatus(txHash);
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`[BridgeSDK] Axelar [${attempt}] (${elapsed}s): ${status.status}`);
      if (status.status === "destination_executed") {
        console.log(`[BridgeSDK] ✅ Axelar complete after ${elapsed}s`);
        return;
      }
      if (status.status === "insufficient_fee") {
        throw new Error(`[BridgeSDK] Axelar insufficient_fee for ${txHash}. Use recover().`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(`[BridgeSDK] Axelar timed out after ${timeoutMs / 1000}s`);
  }

  // ── Multi-hop transfer ─────────────────────────────────────────────────────

  // Executes hops sequentially, waiting for each to settle before starting the next.
  //
  // Wait strategy per protocol:
  //   Wormhole TokenBridge    — synchronous, SDK completes the dest TX, no extra wait needed
  //   Axelar                  — async relay, poll until "destination_executed"
  //   Wormhole AutomaticBridge— cannot be an intermediate hop, relayer timing is unreliable
  async multiHop(
    hops: HopRequest[],
    options: { axelarTimeoutMs?: number; axelarIntervalMs?: number } = {}
  ): Promise<MultiHopResult> {
    if (hops.length < 2) throw new Error("[BridgeSDK] multiHop requires at least 2 hops");

    const results: TransferResult[] = [];

    for (let i = 0; i < hops.length; i++) {
      const { protocol, req } = hops[i];
      const isLastHop = i === hops.length - 1;

      console.log(`\n[BridgeSDK] ── Hop ${i + 1}/${hops.length} via ${protocol.toUpperCase()} ──`);
      console.log(`[BridgeSDK] ${req.fromChain} → ${req.toChain}`);

      const result = await this.transfer(protocol, req);
      results.push(result);
      console.log(`[BridgeSDK] Hop ${i + 1} source TX:`, result.sourceTx);

      if (isLastHop) break;

      if (protocol === "wormhole" && result.mode === "manual") {
        console.log(`[BridgeSDK] ✅ Wormhole manual complete — dest TX: ${result.destinationTx}`);
      } else if (protocol === "axelar") {
        const txHash = Array.isArray(result.sourceTx) ? result.sourceTx[0] : result.sourceTx;
        await this.waitForAxelar(txHash, options.axelarTimeoutMs, options.axelarIntervalMs);
      } else if (protocol === "wormhole" && result.mode === "automatic") {
        throw new Error(`[BridgeSDK] Wormhole AutomaticTokenBridge cannot be an intermediate hop. Use TokenBridge.`);
      } else {
        console.warn(`[BridgeSDK] ⚠️  Unknown wait strategy for "${protocol}".`);
      }
    }

    console.log("\n[BridgeSDK] All hops complete!");
    return { hops: results, success: true };
  }
}