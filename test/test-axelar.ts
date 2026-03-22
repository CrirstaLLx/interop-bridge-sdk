// ─────────────────────────────────────────────────────────────────────────────
// test/axelar-integration.ts
//
// Real transaction test: Sepolia → OP Sepolia via Axelar
//
// Run:  npx ts-node test/axelar-integration.ts
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

import { BridgeSDK } from "../src/sdk";
import { AxelarAdapter } from "../src/axelar/AxelarAdapter";
import { TransferRequest } from "../src/types";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  rpcUrl:    "https://ethereum-sepolia-rpc.publicnode.com",

  // Your deployed contracts
  sourceContract: "0xAe809E3bbC80090920aAb24675702932619DCf2e",  // Sepolia
  destContract:   "0xE816791A620506c6A1da03b491221e2E89dd528e",  // OP Sepolia

  // aUSDC on Sepolia (official Axelar testnet address)
  aUSDC_ADDRESS: "0x254d06f33bDc5b8ee05b2ea472107E300226659A",

  AMOUNT:   "0.1",  // how much aUSDC to send
  DECIMALS: 6,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing .env variable: ${key}`);
  return val;
}

function separator(label: string) {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  separator("🔧  Setup");

  const privateKey = requireEnv("PRIVATE_KEY");
  const provider   = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  const signer     = new ethers.Wallet(privateKey, provider);
  const address    = await signer.getAddress();

  console.log("Wallet address :", address);
  console.log("Source chain   : ethereum-sepolia");
  console.log("Dest chain     : arbitrum-sepolia");

  // ── ETH balance check ──────────────────────────────────────────────────────
  separator("💰  Balances");

  const ethBalance = await provider.getBalance(address);
  console.log("ETH balance    :", ethers.formatEther(ethBalance), "ETH");

  if (ethBalance < ethers.parseEther("0.005")) {
    throw new Error(
      "Not enough ETH for gas! Get testnet ETH from https://sepoliafaucet.com"
    );
  }

  // ── aUSDC balance check ────────────────────────────────────────────────────
  const sdk = new BridgeSDK().register("axelar", new AxelarAdapter(signer));

  const balanceResult = await sdk.use("axelar");

  // Direct balance check via AxelarAdapter's underlying bridge
  const tokenContract = new ethers.Contract(
    CONFIG.aUSDC_ADDRESS,
    ["function balanceOf(address) view returns (uint256)"],
    signer
  );
  const rawBalance = await tokenContract.balanceOf(address);
  const formattedBalance = ethers.formatUnits(rawBalance, CONFIG.DECIMALS);
  console.log("aUSDC balance  :", formattedBalance, "aUSDC");

  if (rawBalance < ethers.parseUnits(CONFIG.AMOUNT, CONFIG.DECIMALS)) {
    throw new Error(
      `Not enough aUSDC! You have ${formattedBalance}, need ${CONFIG.AMOUNT}.\n` +
      "Get testnet aUSDC from: https://faucet.circle.com or Axelar Discord faucet"
    );
  }

  // ── Build TransferRequest ──────────────────────────────────────────────────
  separator("📋  Transfer request");

  const req: TransferRequest = {
    fromChain: "ethereum-sepolia",
    toChain:   "arbitrum-sepolia",
    token:     CONFIG.aUSDC_ADDRESS,
    amount:    CONFIG.AMOUNT,
    decimals:  CONFIG.DECIMALS,
    extra: {
      sourceContractAddress:      CONFIG.sourceContract,
      destinationContractAddress: CONFIG.destContract,
      tokenSymbol:                "aUSDC",
      tokenAddress:               CONFIG.aUSDC_ADDRESS, // for auto-approve
      gasFee:                     "0",                  // will be filled after estimate
    },
  };

  console.log("From    :", req.fromChain);
  console.log("To      :", req.toChain);
  console.log("Token   : aUSDC");
  console.log("Amount  :", req.amount);

  // ── Step 1: Estimate fee ───────────────────────────────────────────────────
  separator("⛽  Step 1 — Estimate fee");

  const feeEstimate = await sdk.use("axelar").estimateFee(req);
  console.log("Fee     :", feeEstimate.fee, feeEstimate.feeToken);
  console.log("Raw     :", JSON.stringify(feeEstimate.raw, null, 2));

  if (!feeEstimate.fee || feeEstimate.fee === "unknown") {
    throw new Error("Could not estimate fee — check chain names and contract addresses");
  }

  // Add 20% buffer on top of estimated fee
  const feeWithBuffer = (parseFloat(feeEstimate.fee) * 1.2).toFixed(6);
  console.log("Fee + 20% buffer:", feeWithBuffer, "ETH");

  // Inject real fee into request
  (req.extra as any).gasFee = feeWithBuffer;

  // ── Step 2: Execute transfer ───────────────────────────────────────────────
  separator("🚀  Step 2 — Execute transfer");

  console.log("Sending transaction...");
  const result = await sdk.transfer("axelar", req);

  console.log("\n✅  Transaction sent!");
  console.log("Protocol   :", result.protocol);
  console.log("Source TX  :", result.sourceTx);
  console.log("Mode       :", result.mode);

  // ── Step 3: Track on Axelarscan ───────────────────────────────────────────
  separator("🔍  Step 3 — Track transaction");

  const txHash = Array.isArray(result.sourceTx) ? result.sourceTx[0] : result.sourceTx;
  console.log("Track your transaction on Axelarscan:");
  console.log(`https://testnet.axelarscan.io/gmp/${txHash}`);
  console.log("\nIt takes ~2-5 minutes for the cross-chain relay to complete.");

  separator("✅  Done");
}

main().catch((err) => {
  console.error("\n❌  Error:", err.message ?? err);
  process.exit(1);
});