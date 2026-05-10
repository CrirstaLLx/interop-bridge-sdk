import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { BridgeSDK } from "../src/sdk";
import { AxelarAdapter } from "../src/axelar/AxelarAdapter";
import { WormholeAdapter } from "../src/wormhole/WormholeAdapter";

// ── Config ────────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const USDC_SEPOLIA  = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const USDC_POLYGON  = "0x2dDd8bB63f18cFB2C20a1E8f6E153F2dD6F7F9Da"; // wrapped USDC on Polygon Sepolia, bridged via Wormhole TokenBridge from Sepolia USDC
const AUSDC_SEPOLIA = "0x254d06f33bDc5b8ee05b2ea472107E300226659A";

const CONTRACT_SEPOLIA  = "0xAe809E3bbC80090920aAb24675702932619DCf2e"; // change to your deployed contract address
const CONTRACT_OPTIMISM = "0xE816791A620506c6A1da03b491221e2E89dd528e"; // change to your deployed contract address

function line(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n  interop-bridge-sdk — demo");
  console.log("  Bridging Diverse Chains: Interoperability in");
  console.log("  Heterogeneous Blockchain Networks\n");

  const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const sepoliaSigner   = new ethers.Wallet(PRIVATE_KEY, sepoliaProvider);

  console.log(`  Wallet : ${await sepoliaSigner.getAddress()}`);

  // ── Test 1: Axelar transfer ───────────────────────────────────────────────
  line("Test 1 — Axelar: ethereum-sepolia → optimism-sepolia");
  console.log("  Estimates relay fee, approves aUSDC, executes transfer.\n");

  const axelarSdk = new BridgeSDK()
    .register("axelar", new AxelarAdapter(sepoliaSigner));

  const axelarReq = {
    fromChain: "ethereum-sepolia",
    toChain:   "optimism-sepolia",
    token:     AUSDC_SEPOLIA,
    amount:    "0.01",
    decimals:  6,
    extra: {
      sourceContractAddress:      CONTRACT_SEPOLIA,
      destinationContractAddress: CONTRACT_OPTIMISM,
      tokenSymbol:                "aUSDC",
      tokenAddress:               AUSDC_SEPOLIA,
      gasFee:                     "0",
    },
  };

  const axelarEstimate = await axelarSdk.use("axelar").estimateFee(axelarReq);
  console.log(`  Fee    : ${axelarEstimate.fee} ${axelarEstimate.feeToken}`);

  axelarReq.extra.gasFee = axelarEstimate.fee;

  const axelarResult = await axelarSdk.transfer("axelar", axelarReq);
  const axelarTx = Array.isArray(axelarResult.sourceTx)
    ? axelarResult.sourceTx[0]
    : axelarResult.sourceTx;

  console.log(`  TX     : ${axelarTx}`);
  console.log(`  Track  : https://testnet.axelarscan.io/gmp/${axelarTx}`);

  // ── Test 2: Wormhole transfer ─────────────────────────────────────────────
  line("Test 2 — Wormhole: ethereum-sepolia → polygon-sepolia");
  console.log("  Uses ExecutorTokenBridge — executor pays destination gas.\n");

  const wormholeSdk = new BridgeSDK()
    .register("wormhole", new WormholeAdapter(PRIVATE_KEY, sepoliaProvider));

  const wormholeResult = await wormholeSdk.transfer("wormhole", {
    fromChain: "Sepolia",
    toChain:   "PolygonSepolia",
    token:     USDC_SEPOLIA,
    amount:    "0.01",
    decimals:  6,
    extra: { protocol: "ExecutorTokenBridge", ensureWrapped: true },
  });

  const wormholeTx = Array.isArray(wormholeResult.sourceTx)
    ? wormholeResult.sourceTx[0]
    : wormholeResult.sourceTx;

  console.log(`  TX     : ${wormholeTx}`);
  console.log(`  Track  : https://wormholescan.io/#/tx/${wormholeTx}?network=Testnet`);

  // ── Test 3: sendTransfer — automatic protocol selection ───────────────────
  line("Test 3 — sendTransfer: ethereum-sepolia → optimism-sepolia");
  console.log("  SDK estimates fees for both protocols and picks the cheapest.\n");

  const autoSdk = new BridgeSDK()
    .register("axelar",   new AxelarAdapter(sepoliaSigner))
    .register("wormhole", new WormholeAdapter(PRIVATE_KEY, sepoliaProvider));

  const autoResult = await autoSdk.sendTransfer({
    fromChain: "ethereum-sepolia",
    toChain:   "optimism-sepolia",
    token:     AUSDC_SEPOLIA,
    amount:    "0.01",
    decimals:  6,
    provider:  sepoliaProvider,
  });

  const autoTx = autoResult.routeType === "direct"
    ? (autoResult.result as any).sourceTx
    : (autoResult.result as any).hops?.[0]?.sourceTx;
  const autoTxStr = Array.isArray(autoTx) ? autoTx[0] : autoTx;

  console.log(`  Selected  : ${autoResult.protocol}`);
  console.log(`  Route     : ${autoResult.routeDescription}`);
  if (autoResult.feeEstimate) {
    console.log(`  Fee       : ${autoResult.feeEstimate.fee} ${autoResult.feeEstimate.feeToken}`);
  }
  console.log(`  TX        : ${autoTxStr}`);
  if (autoResult.protocol === "axelar") {
    console.log(`  Track     : https://testnet.axelarscan.io/gmp/${autoTxStr}`);
  } else {
    console.log(`  Track     : https://wormholescan.io/#/tx/${autoTxStr}?network=Testnet`);
  }

  // ── Test 4: Multi-hop — Polygon Sepolia → Sepolia → Optimism Sepolia ──────
  line("Test 4 — Multi-hop: PolygonSepolia → Sepolia → OptimismSepolia");
  console.log("  Hop 1: Wormhole TokenBridge (PolygonSepolia → Sepolia)");
  console.log("  Hop 2: Axelar (ethereum-sepolia → optimism-sepolia)\n");

  const multiHopSdk = new BridgeSDK()
    .register("wormhole", new WormholeAdapter(PRIVATE_KEY, sepoliaProvider))
    .register("axelar",   new AxelarAdapter(sepoliaSigner));

  const multiHopResult = await multiHopSdk.multiHop([
    {
      protocol: "wormhole",
      req: {
        fromChain: "PolygonSepolia",
        toChain:   "Sepolia",
        token:     USDC_POLYGON,
        amount:    "0.01",
        decimals:  6,
        extra: { protocol: "TokenBridge", ensureWrapped: true },
      },
    },
    {
      protocol: "axelar",
      req: {
        fromChain: "ethereum-sepolia",
        toChain:   "optimism-sepolia",
        token:     AUSDC_SEPOLIA,
        amount:    "0.01",
        decimals:  6,
        extra: {
          sourceContractAddress:      CONTRACT_SEPOLIA,
          destinationContractAddress: CONTRACT_OPTIMISM,
          tokenSymbol:                "aUSDC",
          tokenAddress:               AUSDC_SEPOLIA,
          gasFee:                     "0.0002",
        },
      },
    },
  ]);

  const hop1Tx = Array.isArray(multiHopResult.hops[0].sourceTx)
    ? multiHopResult.hops[0].sourceTx[0]
    : multiHopResult.hops[0].sourceTx;
  const hop2Tx = Array.isArray(multiHopResult.hops[1].sourceTx)
    ? multiHopResult.hops[1].sourceTx[0]
    : multiHopResult.hops[1].sourceTx;

  console.log(`  Hop 1 TX : ${hop1Tx}`);
  console.log(`  Hop 2 TX : ${hop2Tx}`);
  console.log(`  Track 1  : https://wormholescan.io/#/tx/${hop1Tx}?network=Testnet`);
  console.log(`  Track 2  : https://testnet.axelarscan.io/gmp/${hop2Tx}`);

  console.log("\n  All tests complete.\n");
}

main().catch((err) => {
  console.error("\n  Error:", err?.message ?? err);
  process.exit(1);
});