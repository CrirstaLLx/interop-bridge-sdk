// ─────────────────────────────────────────────────────────────────────────────
// test/test-wormhole.ts
//
// Test: Wormhole ExecutorTokenBridge transfer
//   Ethereum Sepolia → Polygon Sepolia | 0.01 USDC
//
// Run
//   npx ts-node test/test-wormhole.ts
// ─────────────────────────────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { BridgeSDK }       from "../src/sdk";
import { WormholeAdapter } from "../src/wormhole/WormholeAdapter";
import { getUsdcAddress, toWormholeName } from "../src/chains";

// ── Config ────────────────────────────────────────────────────────────────────

const FROM_CHAIN  = "ethereum-sepolia";
const TO_CHAIN    = "polygon-sepolia";
const AMOUNT      = "0.01";
const DECIMALS    = 6;
const RPC_URL     = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

if (!PRIVATE_KEY) throw new Error("❌ PRIVATE_KEY chýba v .env");

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════");
  console.log("  TEST 2: Wormhole ExecutorTokenBridge");
  console.log(`  ${FROM_CHAIN} → ${TO_CHAIN}  |  ${AMOUNT} USDC`);
  console.log("════════════════════════════════════════════\n");

  // Preklad na Wormhole názvy
  const wFrom = toWormholeName(FROM_CHAIN);
  const wTo   = toWormholeName(TO_CHAIN);
  if (!wFrom || !wTo) throw new Error(`Chain nemá Wormhole mapping`);

  const usdcAddress = getUsdcAddress(FROM_CHAIN);
  if (!usdcAddress) throw new Error(`USDC adresa pre ${FROM_CHAIN} chýba v chains.ts`);

  console.log(`Wormhole from : ${wFrom}`);
  console.log(`Wormhole to   : ${wTo}`);
  console.log(`USDC address  : ${usdcAddress}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Wallet        : ${wallet.address}`);
  const ethBal = await provider.getBalance(wallet.address);
  console.log(`ETH balance   : ${ethers.formatEther(ethBal)} ETH\n`);

  const sdk = new BridgeSDK();
  sdk.register("wormhole", new WormholeAdapter(PRIVATE_KEY, provider));

  // Krok 1: Estimácia fee
  console.log("── Krok 1: Estimácia Wormhole fee ───────────");
  const feeEst = await sdk.use("wormhole").estimateFee({
    fromChain: wFrom,
    toChain:   wTo,
    token:     usdcAddress,
    amount:    AMOUNT,
    decimals:  DECIMALS,
    extra: {
      protocol:      "ExecutorTokenBridge",
      ensureWrapped: true,
    },
  });

  console.log(`Relay fee (dest)  : ${feeEst.destinationCost?.amount ?? feeEst.fee} ${feeEst.feeToken}`);
  console.log(`Source gas (est.) : ${feeEst.sourceCost?.amount ?? "N/A"} ${feeEst.feeToken}`);
  const raw = feeEst.raw as any;
  if (raw?.msgValue !== undefined) {
    console.log(`Executor msgValue : ${raw.msgValue} wei`);
    console.log(`Executor gasLimit : ${raw.gasLimit}`);
  }

  // Krok 2: Transfer
  console.log("\n── Krok 2: Transfer ─────────────────────────");
  console.log("Inicializujem Wormhole SDK (môže trvať ~10s)...\n");

  const result = await sdk.transfer("wormhole", {
    fromChain: wFrom,
    toChain:   wTo,
    token:     usdcAddress,
    amount:    AMOUNT,
    decimals:  DECIMALS,
    extra: {
      protocol:      "ExecutorTokenBridge",
      ensureWrapped: true,
    },
  });

  const sourceTxStr = Array.isArray(result.sourceTx) ? result.sourceTx[0] : result.sourceTx;

  console.log("\n✅ Transfer odoslaný!");
  console.log(`Source TX  : ${sourceTxStr}`);
  console.log(`Mode       : ${result.mode}`);
  console.log(`\nWormholescan : https://wormholescan.io/#/tx/${sourceTxStr}?network=Testnet`);
}

main().catch((err) => {
  console.error("\n❌ Chyba:", err?.message ?? err);
  process.exit(1);
});