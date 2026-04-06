// ─────────────────────────────────────────────────────────────────────────────
// test/test-route-selector.ts
//
// Test: RouteSelector сomparing Axelar and Wormhole fees for a transfer
//   EXECUTE=1 npx ts-node --project tsconfig.test.json test/test-route-selector.ts
// ─────────────────────────────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { BridgeSDK }       from "../src/sdk";
import { RouteSelector }   from "../src/RouteSelector";
import { AxelarAdapter }   from "../src/axelar/AxelarAdapter";
import { WormholeAdapter } from "../src/wormhole/WormholeAdapter";
import {
  getChain,
  getUsdcAddress,
  getAxelarUsdcAddress,
  toAxelarName,
  toWormholeName,
} from "../src/chains";

// ── Config ────────────────────────────────────────────────────────────────────

// Táto trasa funguje cez OBA protokoly → ideálna na porovnanie
const FROM_CHAIN  = "ethereum-sepolia";
const TO_CHAIN    = "base-sepolia";
const AMOUNT      = "0.01";
const DECIMALS    = 6;
const RPC_URL     = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

if (!PRIVATE_KEY) throw new Error("❌ PRIVATE_KEY chýba v .env");

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════");
  console.log("  TEST 3: RouteSelector – Axelar vs Wormhole");
  console.log(`  ${FROM_CHAIN} → ${TO_CHAIN}  |  ${AMOUNT} USDC`);
  console.log("════════════════════════════════════════════\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Wallet : ${signer.address}\n`);

  // Token adresy
  const wormholeToken = getUsdcAddress(FROM_CHAIN)!;   // USDC pre Wormhole
  const axelarToken   = getAxelarUsdcAddress(FROM_CHAIN)!; // aUSDC pre Axelar

  // RouteSelector dostane Wormhole USDC adresu ako token — pre Axelar si sám
  // vytiahne axelarUsdcAddress z chains.ts cez buildRequest()
  const tokenForSelector = wormholeToken;

  if (!wormholeToken) throw new Error(`USDC adresa pre ${FROM_CHAIN} chýba v chains.ts`);
  if (!axelarToken)   throw new Error(`aUSDC adresa pre ${FROM_CHAIN} chýba v chains.ts`);

  // Setup SDK s oboma adaptermi
  const sdk = new BridgeSDK();
  sdk.register("axelar",   new AxelarAdapter(signer));
  sdk.register("wormhole", new WormholeAdapter(PRIVATE_KEY, provider));

  const selector = new RouteSelector(sdk, provider);

  console.log("Hľadám a porovnávam trasy (estimácia fee)...\n");

  const selection = await selector.selectRoute(
    FROM_CHAIN,
    TO_CHAIN,
    tokenForSelector,
    AMOUNT,
    DECIMALS
  );

  // ── Výsledky ──────────────────────────────────────────────────────────────

  console.log("\n════════════════════════════════════════════");
  console.log("            VÝSLEDOK ROUTE SELECTOR         ");
  console.log("════════════════════════════════════════════");

  for (const est of selection.estimates) {
    const icon = !est.supported ? "❌" : est.error ? "⚠️ " : "✅";
    console.log(`\n${icon} ${est.protocol.toUpperCase()}`);
    if (est.sourceCost) console.log(`   Source gas  : ${est.sourceCost.amount} ${est.sourceCost.token}`);
    if (est.destCost)   console.log(`   Dest relay  : ${est.destCost.amount}   ${est.destCost.token}`);
    if (est.totalCost)  console.log(`   ► Total     : ${est.totalCost} ETH`);
    if (est.error)      console.log(`   Chyba       : ${est.error}`);
  }

  console.log("\n────────────────────────────────────────────");
  const rec = selection.recommended;
  console.log(`Odporúčaný  : ${rec ? `✅ ${rec.toUpperCase()}` : "žiadny"}`);
  console.log(`Dôvod       : ${selection.reason}`);
  console.log("════════════════════════════════════════════\n");

  // ── Voliteľné: ihneď spusti transfer ─────────────────────────────────────

  if (!rec || process.env.EXECUTE !== "1") {
    if (rec) console.log(`💡 Pre spustenie nastav: EXECUTE=1 npx ts-node --project tsconfig.test.json test/test-route-selector.ts`);
    return;
  }

  console.log(`\nEXECUTE=1 → spúšťam transfer cez ${rec.toUpperCase()}...`);

  if (rec === "axelar") {
    const fromInfo = getChain(FROM_CHAIN)!;
    const toInfo   = getChain(TO_CHAIN)!;
    const gasFee   = selection.estimates.find(e => e.protocol === "axelar")?.totalCost ?? "0.005";
    const result   = await sdk.transfer("axelar", {
      fromChain: toAxelarName(FROM_CHAIN)!,
      toChain:   toAxelarName(TO_CHAIN)!,
      token:     axelarToken,
      amount:    AMOUNT,
      decimals:  DECIMALS,
      extra: {
        sourceContractAddress:      fromInfo.axelarContracts?.contractAddress,
        destinationContractAddress: toInfo.axelarContracts?.contractAddress,
        tokenSymbol:                "aUSDC",
        tokenAddress:               axelarToken,
        gasFee,
      },
    });
    console.log("✅ Axelar TX:", result.sourceTx);
    console.log(`Axelarscan : https://testnet.axelarscan.io/gmp/${result.sourceTx}`);

  } else if (rec === "wormhole") {
    const result = await sdk.transfer("wormhole", {
      fromChain: toWormholeName(FROM_CHAIN)!,
      toChain:   toWormholeName(TO_CHAIN)!,
      token:     wormholeToken,
      amount:    AMOUNT,
      decimals:  DECIMALS,
      extra: { protocol: "ExecutorTokenBridge", ensureWrapped: true },
    });
    const txStr = Array.isArray(result.sourceTx) ? result.sourceTx[0] : result.sourceTx;
    console.log("✅ Wormhole TX:", txStr);
    console.log(`Wormholescan : https://wormholescan.io/#/tx/${txStr}?network=Testnet`);
  }
}

main().catch((err) => {
  console.error("\n❌ Chyba:", err?.message ?? err);
  process.exit(1);
});