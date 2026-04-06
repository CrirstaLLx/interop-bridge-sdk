// ─────────────────────────────────────────────────────────────────────────────
// src/RouteSelector.ts
//
// Automatically selects the best bridge protocol for a given transfer route.
//
// Chain support and name translation is driven entirely by chains.ts —
// there are no hardcoded chain sets or name maps here.
//
// Route modes:
//   Direct  — one protocol handles the full from→to route.
//   Multi-hop — no single protocol covers the route; RouteSelector finds an
//               intermediate "hub" chain and builds a 2-leg path
//               (e.g. Axelar from→hub + Wormhole hub→to).
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";
import { BridgeSDK } from "./sdk";
import { TransferRequest, FeeEstimate } from "./types";
import {
  toWormholeName,
  toAxelarName,
  getNativeToken,
  supportsAxelar,
  supportsWormhole,
  axelarRouteExists,
  wormholeRouteExists,
  getChain,
  getAxelarUsdcAddress,
  HUB_CHAINS,
} from "./chains";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RouteEstimate {
  protocol:   string;
  supported:  boolean;
  estimate:   FeeEstimate | null;
  /** Gas cost on the source chain (approve + initiateTransfer) */
  sourceCost: { amount: string; token: string; chain: string } | null;
  /** Relay / executor fee paid to deliver tokens on the destination chain */
  destCost:   { amount: string; token: string; chain: string } | null;
  /** Total cost expressed in source chain native token */
  totalCost:  string | null;
  error?:     string;
}

export interface RouteSelection {
  /** Protocol name of the winner, or null if no route was found */
  recommended: string | null;
  reason:      string;
  estimates:   RouteEstimate[];
}

/** A single leg of a multi-hop path */
export interface HopPath {
  protocol:  string;
  fromChain: string;
  toChain:   string;
}

/** Result of multi-hop path discovery */
export interface MultiHopRoute {
  found:      boolean;
  hops:       HopPath[];
  /** Human-readable description, e.g. "axelar: sepolia→avalanche + wormhole: avalanche→injective" */
  description: string;
}

// ── RouteSelector ──────────────────────────────────────────────────────────────

export class RouteSelector {
  constructor(
    private readonly sdk:      BridgeSDK,
    private readonly provider: ethers.Provider
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Find and rank all viable routes for a transfer.
   *
   * Steps:
   *   1. Try every registered protocol for a direct route.
   *   2. If no direct route works, search for a 2-hop path via hub chains.
   *
   * @param fromChain  Source chain — canonical key from chains.ts (e.g. "ethereum-sepolia")
   * @param toChain    Destination chain key
   * @param token      Token address on the source chain
   * @param amount     Human-readable transfer amount (e.g. "1.0")
   * @param decimals   Token decimals (6 for USDC)
   * @param extra      Protocol-specific extras merged into the TransferRequest
   */
  async selectRoute(
    fromChain: string,
    toChain:   string,
    token:     string,
    amount:    string,
    decimals:  number,
    extra?:    Record<string, unknown>
  ): Promise<RouteSelection> {
    const protocols = this.sdk.protocols();

    console.log(`\n[RouteSelector] Route: ${fromChain} → ${toChain}`);
    console.log(`[RouteSelector] Protocols registered: ${protocols.join(", ")}`);

    // ── Step 1: direct routes ─────────────────────────────────────────────
    const estimates = await this.evaluateDirectRoutes(
      protocols, fromChain, toChain, token, amount, decimals, extra
    );

    const directValid = estimates.filter((e) => e.supported && !e.error && e.totalCost !== null);

    if (directValid.length > 0) {
      return this.recommend(estimates, `${fromChain} → ${toChain}`);
    }

    // ── Step 2: multi-hop fallback ────────────────────────────────────────
    console.log("[RouteSelector] No direct route found — searching for multi-hop path...");
    const multiHop = this.findMultiHopPath(protocols, fromChain, toChain);

    if (!multiHop.found) {
      return {
        recommended: null,
        reason:      `No route found from ${fromChain} to ${toChain} with registered protocols.`,
        estimates,
      };
    }

    console.log(`[RouteSelector] Multi-hop path found: ${multiHop.description}`);

    return {
      recommended: null,          // Multi-hop requires sdk.multiHop(), not a single protocol
      reason:      `No single protocol covers ${fromChain} → ${toChain}. ` +
                   `Use sdk.multiHop() with this path: ${multiHop.description}`,
      estimates: [
        ...estimates,
        this.buildMultiHopEstimate(multiHop),
      ],
    };
  }

  /**
   * Check whether a protocol supports both ends of a route.
   * Uses chains.ts as the authority — no hardcoded sets here.
   */
  isSupported(protocol: string, fromChain: string, toChain: string): boolean {
    switch (protocol) {
      case "axelar":
        return axelarRouteExists(fromChain, toChain);
      case "wormhole":
        return wormholeRouteExists(fromChain, toChain);
      default:
        // Unknown protocol — assume it handles its own support checks
        return true;
    }
  }

  /**
   * Find a 2-hop path when no single protocol covers the full route.
   *
   * Searches HUB_CHAINS for an intermediate chain H such that:
   *   Protocol A supports (from → H)  and  Protocol B supports (H → to)
   *
   * The two legs can use different protocols.
   */
  findMultiHopPath(
    protocols: string[],
    fromChain: string,
    toChain:   string
  ): MultiHopRoute {
    for (const hub of HUB_CHAINS) {
      if (hub === fromChain || hub === toChain) continue;

      for (const protocolA of protocols) {
        if (!this.isSupported(protocolA, fromChain, hub)) continue;

        for (const protocolB of protocols) {
          if (!this.isSupported(protocolB, hub, toChain)) continue;

          const hops: HopPath[] = [
            { protocol: protocolA, fromChain, toChain: hub },
            { protocol: protocolB, fromChain: hub, toChain },
          ];

          return {
            found:       true,
            hops,
            description: `${protocolA}: ${fromChain}→${hub} + ${protocolB}: ${hub}→${toChain}`,
          };
        }
      }
    }

    return { found: false, hops: [], description: "no path found" };
  }

  // ── Direct route evaluation ────────────────────────────────────────────────

  private async evaluateDirectRoutes(
    protocols: string[],
    fromChain: string,
    toChain:   string,
    token:     string,
    amount:    string,
    decimals:  number,
    extra?:    Record<string, unknown>
  ): Promise<RouteEstimate[]> {
    const estimates: RouteEstimate[] = [];

    for (const protocol of protocols) {
      const supported = this.isSupported(protocol, fromChain, toChain);

      if (!supported) {
        console.log(`[RouteSelector] ${protocol}: ❌ not supported`);
        estimates.push({
          protocol,
          supported:  false,
          estimate:   null,
          sourceCost: null,
          destCost:   null,
          totalCost:  null,
          error:      `Route ${fromChain} → ${toChain} is not supported by ${protocol}`,
        });
        continue;
      }

      const req = this.buildRequest(protocol, fromChain, toChain, token, amount, decimals, extra);

      try {
        console.log(`[RouteSelector] ${protocol}: estimating fee...`);
        const estimate = await this.sdk.use(protocol).estimateFee(req);

        const sourceCost = estimate.sourceCost ?? {
          amount: estimate.fee,
          token:  estimate.feeToken,
          chain:  fromChain,
        };
        const destCost   = estimate.destinationCost ?? null;
        const totalCost  = this.computeTotal(estimate);

        this.logEstimate(protocol, sourceCost, destCost, totalCost);

        estimates.push({ protocol, supported: true, estimate, sourceCost, destCost, totalCost });

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[RouteSelector] ${protocol}: ⚠️  estimation failed — ${msg}`);
        estimates.push({
          protocol,
          supported:  true,
          estimate:   null,
          sourceCost: null,
          destCost:   null,
          totalCost:  null,
          error:      msg,
        });
      }
    }

    return estimates;
  }

  // ── Request builder ────────────────────────────────────────────────────────

  /**
   * Build a protocol-specific TransferRequest.
   *
   * For Wormhole: translates chain keys to Wormhole names and injects
   *               ExecutorTokenBridge as the default protocol.
   * For Axelar:   passes chain keys as-is (Axelar SDK uses its own names
   *               which are stored in chains.ts as axelarName).
   */
  private buildRequest(
    protocol:  string,
    fromChain: string,
    toChain:   string,
    token:     string,
    amount:    string,
    decimals:  number,
    extra?:    Record<string, unknown>
  ): TransferRequest {
    if (protocol === "wormhole") {
      const wFrom = toWormholeName(fromChain) ?? fromChain;
      const wTo   = toWormholeName(toChain)   ?? toChain;
      return {
        fromChain: wFrom,
        toChain:   wTo,
        token,
        amount,
        decimals,
        extra: {
          protocol:      "ExecutorTokenBridge",
          ensureWrapped: true,
          ...extra,
        },
      };
    }

    if (protocol === "axelar") {
      // Translate canonical key → Axelar SDK name (e.g. "avalanche" → "Avalanche")
      const aFrom = toAxelarName(fromChain) ?? fromChain;
      const aTo   = toAxelarName(toChain)   ?? toChain;

      // Pull contract addresses and token info from registry if not supplied in extra
      const fromInfo = getChain(fromChain);
      const toInfo   = getChain(toChain);

      return {
        fromChain: aFrom,
        toChain:   aTo,
        token,
        amount,
        decimals,
        extra: {
          sourceContractAddress:      fromInfo?.axelarContracts?.contractAddress,
          destinationContractAddress: toInfo?.axelarContracts?.contractAddress,
          tokenSymbol:                fromInfo?.axelarTokenSymbol ?? "aUSDC",
          // aUSDC contract address on the source chain — needed for approve()
          tokenAddress:               getAxelarUsdcAddress(fromChain),
          gasFee:                     "0",   // placeholder — caller should run estimateFee first
          ...extra,
        },
      };
    }

    // Generic fallback for future protocols
    return { fromChain, toChain, token, amount, decimals, extra };
  }

  // ── Total cost computation ─────────────────────────────────────────────────

  /**
   * Sum source gas + relay fee into a single comparable number.
   * When tokens differ (e.g. source ETH, dest MATIC), returns source cost only.
   */
  private computeTotal(estimate: FeeEstimate): string {
    try {
      const sourceFee = parseFloat(estimate.sourceCost?.amount ?? estimate.fee ?? "0");
      const destFee   = parseFloat(estimate.destinationCost?.amount ?? "0");

      const sameToken =
        !estimate.destinationCost ||
        estimate.sourceCost?.token === estimate.destinationCost?.token;

      return sameToken
        ? (sourceFee + destFee).toFixed(8)
        : sourceFee.toFixed(8);
    } catch {
      return estimate.fee ?? "0";
    }
  }

  // ── Multi-hop estimate placeholder ────────────────────────────────────────

  /**
   * Build a synthetic RouteEstimate that describes a multi-hop path.
   * Fees are unknown at this stage — the caller must run estimateFee per leg.
   */
  private buildMultiHopEstimate(route: MultiHopRoute): RouteEstimate {
    return {
      protocol:   `multi-hop (${route.hops.map((h) => h.protocol).join(" + ")})`,
      supported:  true,
      estimate:   null,
      sourceCost: null,
      destCost:   null,
      totalCost:  null,
      error:      `Multi-hop required. Path: ${route.description}. ` +
                  `Use sdk.multiHop() to execute.`,
    };
  }

  // ── Recommendation ─────────────────────────────────────────────────────────

  private recommend(estimates: RouteEstimate[], routeLabel: string): RouteSelection {
    const valid = estimates.filter(
      (e) => e.supported && e.totalCost !== null && !e.error
    );

    if (valid.length === 0) {
      const allUnsupported = estimates.every((e) => !e.supported);
      return {
        recommended: null,
        reason: allUnsupported
          ? `No registered protocol supports ${routeLabel}.`
          : `${routeLabel} is supported but fee estimation failed for all protocols.`,
        estimates,
      };
    }

    if (valid.length === 1) {
      return {
        recommended: valid[0].protocol,
        reason:      `Only ${valid[0].protocol} supports ${routeLabel}.`,
        estimates,
      };
    }

    // Multiple viable protocols — pick cheapest
    valid.sort((a, b) => parseFloat(a.totalCost!) - parseFloat(b.totalCost!));

    const cheapest  = valid[0];
    const expensive = valid[1];
    const saving    = (
      parseFloat(expensive.totalCost!) - parseFloat(cheapest.totalCost!)
    ).toFixed(8);
    const token = cheapest.sourceCost?.token ?? getNativeToken(cheapest.protocol);

    return {
      recommended: cheapest.protocol,
      reason:
        `${cheapest.protocol} is cheaper by ~${saving} ${token} ` +
        `(${cheapest.totalCost} vs ${expensive.totalCost} ${token}).`,
      estimates,
    };
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  private logEstimate(
    protocol:   string,
    sourceCost: { amount: string; token: string; chain: string },
    destCost:   { amount: string; token: string; chain: string } | null,
    totalCost:  string | null
  ) {
    console.log(`[RouteSelector] ${protocol}:`);
    console.log(`  Source (gas) : ${sourceCost.amount} ${sourceCost.token} (${sourceCost.chain})`);
    if (destCost) {
      console.log(`  Dest (relay) : ${destCost.amount} ${destCost.token} (${destCost.chain})`);
    }
    if (totalCost) {
      console.log(`  Total        : ${totalCost} ${sourceCost.token}`);
    }
  }
}