// ─────────────────────────────────────────────────────────────────────────────
// test/test-wormhole.ts
//
// Real transaction test: Ethereum Sepolia → Polygon Sepolia via Wormhole
// Protocol: TokenBridge (manual relay — SDK completes destination tx)
//
// Run:  npx ts-node test/test-wormhole.ts
// ─────────────────────────────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config();

import { BridgeSDK } from "../src/sdk";
import { WormholeAdapter } from "../src/wormhole/WormholeAdapter";
import { TransferRequest } from "../src/types";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  // USDC on Ethereum Sepolia
  // Use the address of the USDC token you already have on Sepolia
  USDC_ADDRESS: process.env.USDC_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",

  AMOUNT:   "0.01",  // small amount for testing
  DECIMALS: 6,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function separator(label: string) {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  separator("🔧  Setup");

  const sdk = new BridgeSDK().register("wormhole", new WormholeAdapter());

  console.log("Initializing Wormhole SDK...");
  // WormholeAdapter.init() is called automatically on first use

  console.log("Source chain   : Sepolia (Ethereum Sepolia)");
  console.log("Dest chain     : PolygonSepolia");
  console.log("Token          : USDC →  wrapped USDC on destination");
  console.log("Protocol       : TokenBridge (manual relay)");
  console.log("Amount         :", CONFIG.AMOUNT, "USDC");

  // ── Build TransferRequest ──────────────────────────────────────────────────
  separator("📋  Transfer request");

  const req: TransferRequest = {
    fromChain: "Sepolia",         // Wormhole chain name for Ethereum Sepolia
    toChain:   "PolygonSepolia",  // Wormhole chain name for Polygon Sepolia
    token:     CONFIG.USDC_ADDRESS,
    amount:    CONFIG.AMOUNT,
    decimals:  CONFIG.DECIMALS,
    extra: {
      protocol:      "TokenBridge",
      ensureWrapped: true,  // auto-attestation if token not wrapped yet
    },
  };

  console.log("From    :", req.fromChain);
  console.log("To      :", req.toChain);
  console.log("Token   :", req.token);
  console.log("Amount  :", req.amount);

  // ── Step 1: Estimate fee ───────────────────────────────────────────────────
  separator("⛽  Step 1 — Estimate fee");

  console.log("Fetching quote...");
  try {
    const feeEstimate = await sdk.use("wormhole").estimateFee(req);
    console.log("Fee      :", feeEstimate.fee, feeEstimate.feeToken);
    console.log("Raw quote:", JSON.stringify(feeEstimate.raw, null, 2));
  } catch (err: any) {
    // Fee estimate can fail if there's no relayer for this route — not critical for TokenBridge
    console.warn("⚠️  Fee estimate failed (non-critical for TokenBridge):", err.message);
  }

  // ── Step 2: Execute transfer ───────────────────────────────────────────────
  separator("🚀  Step 2 — Execute transfer");

  console.log("Initiating transfer...");
  console.log("(If token is not wrapped yet, attestation will run first — this can take ~2 min)");

  const result = await sdk.transfer("wormhole", req);

  console.log("\n✅  Transfer complete!");
  console.log("Protocol      :", result.protocol);
  console.log("Source TX     :", result.sourceTx);
  console.log("Destination TX:", result.destinationTx);
  console.log("Mode          :", result.mode);

  // ── Step 3: Track on Wormholescan ─────────────────────────────────────────
  separator("🔍  Step 3 — Track transaction");

  const sourceTx = Array.isArray(result.sourceTx)
    ? result.sourceTx[0]
    : result.sourceTx;

  console.log("Track your transfer on Wormholescan:");
  console.log(`https://wormholescan.io/#/tx/${sourceTx}?network=Testnet`);

  separator("✅  Done");
}

main().catch((err) => {
  console.error("\n❌  Error:", err.message ?? err);
  process.exit(1);
});