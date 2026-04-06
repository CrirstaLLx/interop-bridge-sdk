// ─────────────────────────────────────────────────────────────────────────────
// test-axelar.ts
//
// Test: Axelar GMP transfer
//   Ethereum Sepolia → Optimism Sepolia | 0.01 aUSDC
//
// Run: npx ts-node test-axelar.ts
// Env: PRIVATE_KEY=0x...
// ─────────────────────────────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { BridgeSDK } from "../src/sdk";
import { AxelarAdapter } from "../src/axelar/AxelarAdapter";
import { getChain, getAxelarUsdcAddress, toAxelarName } from "../src/chains";

// ── Config ────────────────────────────────────────────────────────────────────

const FROM_CHAIN = "ethereum-sepolia";
const TO_CHAIN   = "optimism-sepolia";
const AMOUNT     = "0.01";
const DECIMALS   = 6;

const RPC_URL    = "https://ethereum-sepolia-rpc.publicnode.com"; // alebo Infura/Alchemy
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

if (!PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY chýba v .env");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TEST: Axelar Transfer ===");
  console.log(`Route: ${FROM_CHAIN} → ${TO_CHAIN}`);
  console.log(`Amount: ${AMOUNT} aUSDC\n`);

  // 1. Signer na source chain
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer   = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Wallet: ${await signer.getAddress()}`);
  const balance = await provider.getBalance(signer.address);
  console.log(`ETH balance: ${ethers.formatEther(balance)} ETH\n`);

  // 2. Načítaj info z chains.ts
  const fromInfo = getChain(FROM_CHAIN)!;
  const toInfo   = getChain(TO_CHAIN)!;

  const sourceContract = fromInfo.axelarContracts?.contractAddress;
  const destContract   = toInfo.axelarContracts?.contractAddress;
  const tokenAddress   = getAxelarUsdcAddress(FROM_CHAIN);
  const axelarFrom     = toAxelarName(FROM_CHAIN)!;
  const axelarTo       = toAxelarName(TO_CHAIN)!;

  if (!sourceContract || !destContract || !tokenAddress) {
    throw new Error("Chýbajú contract adresy alebo token adresa v chains.ts");
  }

  console.log(`Source contract : ${sourceContract}`);
  console.log(`Dest contract   : ${destContract}`);
  console.log(`aUSDC address   : ${tokenAddress}`);
  console.log(`Axelar from     : ${axelarFrom}`);
  console.log(`Axelar to       : ${axelarTo}\n`);

  // 3. Setup SDK + Adapter
  const sdk     = new BridgeSDK();
  const adapter = new AxelarAdapter(signer);
  sdk.register("axelar", adapter);

  // 4. Estimácia gas fee
  console.log("── Krok 1: Estimácia Axelar fee ──");
  const feeEstimate = await sdk.use("axelar").estimateFee({
    fromChain: axelarFrom,
    toChain:   axelarTo,
    token:     tokenAddress,
    amount:    AMOUNT,
    decimals:  DECIMALS,
    extra: {
      sourceContractAddress:      sourceContract,
      destinationContractAddress: destContract,
      tokenSymbol:                "aUSDC",
      gasFee:                     "0",  // placeholder pre estimáciu
    },
  });

  const gasFee = feeEstimate.fee ?? "0.005"; // fallback ak estimácia vráti "unknown"
  console.log(`Odhadovaný gas fee : ${gasFee} ${feeEstimate.feeToken}\n`);

  // 5. Skontroluj aUSDC balance
  console.log("── Krok 2: Kontrola aUSDC balance ──");
  const { AxelarBridge } = await import("../src/axelar/AxelarBridge");
  const bridge = new AxelarBridge(signer);
  const bal = await bridge.getBalance({ tokenAddress, decimals: DECIMALS });
  console.log(`aUSDC balance: ${bal.formatted} aUSDC`);

  if (parseFloat(bal.formatted ?? "0") < parseFloat(AMOUNT)) {
    console.warn(`⚠️  Nedostatočný aUSDC balance (${bal.formatted}). Transfer sa pravdepodobne zlyhá.`);
    console.warn(`   Získaj testnet aUSDC na: https://faucet.circle.com/ (vyber Sepolia)\n`);
  }

  // 6. Presnej transfer
  console.log("── Krok 3: Spustenie transferu ──");
  const result = await sdk.transfer("axelar", {
    fromChain: axelarFrom,
    toChain:   axelarTo,
    token:     tokenAddress,
    amount:    AMOUNT,
    decimals:  DECIMALS,
    extra: {
      sourceContractAddress:      sourceContract,
      destinationContractAddress: destContract,
      tokenSymbol:                "aUSDC",
      tokenAddress,
      gasFee,
    },
  });

  console.log("\n✅ Transfer odoslaný!");
  console.log(`Source TX  : ${result.sourceTx}`);
  console.log(`Mode       : ${result.mode}`);
  console.log(`\nAxelarscan : https://testnet.axelarscan.io/gmp/${result.sourceTx}`);
}

main().catch((err) => {
  console.error("\n❌ Chyba:", err.message ?? err);
  process.exit(1);
});