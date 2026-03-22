// ─────────────────────────────────────────────────────────────────────────────
// test/test-multihop.ts
//
// Multi-hop: Polygon Sepolia → (Wormhole) → Arbitrum Sepolia → (Axelar) → OP Sepolia
//
// Hop 1 — Wormhole TokenBridge (manual)
//   From : Polygon Sepolia  (you have MATIC for gas)
//   To   : Arbitrum Sepolia (intermediate chain, in both protocols)
//   Token: USDC on Polygon Sepolia
//   Result: wormhole-wrapped USDC arrives on Arbitrum Sepolia
//
// Hop 2 — Axelar
//   From : Arbitrum Sepolia (you have contract 0xE816...)
//   To   : Optimism Sepolia (you have contract 0xE816...)
//   Token: aUSDC on Arbitrum Sepolia
//   Result: aUSDC arrives on Optimism Sepolia
//
// NOTE: You need a small amount of ETH on Arbitrum Sepolia for Axelar gas.
//       Get it from: https://faucet.quicknode.com/arbitrum/sepolia
//
// Run: npx ts-node test/test-multihop.ts
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

import { BridgeSDK } from "../src/sdk";
import { AxelarAdapter } from "../src/axelar/AxelarAdapter";
import { WormholeAdapter } from "../src/wormhole/WormholeAdapter";
import { TransferRequest } from "../src/types";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  // Hop 1 — Wormhole: Polygon Sepolia → Arbitrum Sepolia
  WORMHOLE: {
    fromChain:    "PolygonSepolia",   // Wormhole chain name
    toChain:      "ArbitrumSepolia",  // Wormhole chain name
    tokenAddress: "0x8B0180f2101c8260d49339abfEe87927412494B4", // USDC on Polygon Sepolia
    amount:       "0.01",
    decimals:     6,
  },

  // Hop 2 — Axelar: Arbitrum Sepolia → Optimism Sepolia
  AXELAR: {
    fromChain: "arbitrum-sepolia",
    toChain:   "optimism-sepolia",
    rpcUrl:    "https://sepolia-rollup.arbitrum.io/rpc",
    aUSDC_ADDRESS:              "0xA2Ba06a76eC793d1Faf23Cc8220A887402b27331",
    sourceContractAddress:      "0xE816791A620506c6A1da03b491221e2E89dd528e", // your Arbitrum contract
    destinationContractAddress: "0xE816791A620506c6A1da03b491221e2E89dd528e", // your OP Sepolia contract
    amount:   "0.01",
    decimals: 6,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function separator(label: string) {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

async function checkBalance(
  rpcUrl: string,
  walletAddress: string,
  tokenAddress: string,
  tokenName: string,
  decimals: number,
  minRequired: string
): Promise<{ ethBalance: bigint; tokenBalance: bigint }> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ethBalance = await provider.getBalance(walletAddress);
  const token = new ethers.Contract(
    tokenAddress,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const tokenBalance = await token.balanceOf(walletAddress);

  console.log(`  ETH balance  : ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`  ${tokenName} balance: ${ethers.formatUnits(tokenBalance, decimals)} ${tokenName}`);

  if (tokenBalance < ethers.parseUnits(minRequired, decimals)) {
    throw new Error(
      `Not enough ${tokenName}! Have ${ethers.formatUnits(tokenBalance, decimals)}, need ${minRequired}.`
    );
  }

  return { ethBalance, tokenBalance };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  separator("🔧  Setup");

  const privateKey = process.env.PRIVATE_KEY!;

  // Signer for Hop 2 — Axelar runs from Arbitrum Sepolia
  const arbitrumProvider = new ethers.JsonRpcProvider(CONFIG.AXELAR.rpcUrl);
  const arbitrumSigner   = new ethers.Wallet(privateKey, arbitrumProvider);
  const walletAddress    = await arbitrumSigner.getAddress();

  console.log("Wallet :", walletAddress);
  console.log("Route  : Polygon Sepolia → (Wormhole) → Arbitrum Sepolia → (Axelar) → OP Sepolia");

  // ── Balance checks ─────────────────────────────────────────────────────────
  separator("💰  Balance checks");

  console.log("\n[Hop 1] Polygon Sepolia — USDC for Wormhole:");
  await checkBalance(
    "https://rpc-amoy.polygon.technology",
    walletAddress,
    CONFIG.WORMHOLE.tokenAddress,
    "USDC",
    CONFIG.WORMHOLE.decimals,
    CONFIG.WORMHOLE.amount
  );

  console.log("\n[Hop 2] Arbitrum Sepolia — aUSDC + ETH for Axelar:");
  const { ethBalance: arbEth } = await checkBalance(
    CONFIG.AXELAR.rpcUrl,
    walletAddress,
    CONFIG.AXELAR.aUSDC_ADDRESS,
    "aUSDC",
    CONFIG.AXELAR.decimals,
    CONFIG.AXELAR.amount
  );

  if (arbEth < ethers.parseEther("0.001")) {
    throw new Error(
      "Not enough ETH on Arbitrum Sepolia for Axelar gas!\n" +
      "  → Get testnet ETH: https://faucet.quicknode.com/arbitrum/sepolia"
    );
  }

  // ── Estimate Axelar fee upfront ────────────────────────────────────────────
  separator("⛽  Estimating Axelar fee (Hop 2)");

  const feeSDK = new BridgeSDK().register("axelar", new AxelarAdapter(arbitrumSigner));

  const feeReq: TransferRequest = {
    fromChain: CONFIG.AXELAR.fromChain,
    toChain:   CONFIG.AXELAR.toChain,
    token:     CONFIG.AXELAR.aUSDC_ADDRESS,
    amount:    CONFIG.AXELAR.amount,
    decimals:  CONFIG.AXELAR.decimals,
    extra: {
      sourceContractAddress:      CONFIG.AXELAR.sourceContractAddress,
      destinationContractAddress: CONFIG.AXELAR.destinationContractAddress,
      tokenSymbol:                "aUSDC",
      gasFee:                     "0",
    },
  };

  const feeEstimate = await feeSDK.use("axelar").estimateFee(feeReq);
  const feeWithBuffer = (parseFloat(feeEstimate.fee) * 1.2).toFixed(6);

  console.log("Estimated fee    :", feeEstimate.fee, feeEstimate.feeToken);
  console.log("Fee + 20% buffer :", feeWithBuffer, "ETH");

  // ── Execute multi-hop ──────────────────────────────────────────────────────
  separator("🚀  Executing multi-hop");

  const sdk = new BridgeSDK()
    .register("wormhole", new WormholeAdapter(process.env.ETH_PRIVATE_KEY!))
    .register("axelar",   new AxelarAdapter(arbitrumSigner));

  const result = await sdk.multiHop([
    {
      // ── Hop 1: Wormhole — Polygon Sepolia → Arbitrum Sepolia ──────────────
      protocol: "wormhole",
      req: {
        fromChain: CONFIG.WORMHOLE.fromChain,
        toChain:   CONFIG.WORMHOLE.toChain,
        token:     CONFIG.WORMHOLE.tokenAddress,
        amount:    CONFIG.WORMHOLE.amount,
        decimals:  CONFIG.WORMHOLE.decimals,
        extra: {
          protocol:      "TokenBridge", // manual = SDK waits for destinationTx
          ensureWrapped: true,          // auto-attestation if token not wrapped yet
        },
      },
    },
    {
      // ── Hop 2: Axelar — Arbitrum Sepolia → Optimism Sepolia ───────────────
      // After Hop 1 you have wormhole-wrapped USDC on Arbitrum.
      // Hop 2 uses aUSDC (separate Axelar-issued token).
      // For this demo we assume you already hold aUSDC on Arbitrum Sepolia.
      // In production: swap wUSDC → aUSDC via DEX between hops.
      protocol: "axelar",
      req: {
        fromChain: CONFIG.AXELAR.fromChain,
        toChain:   CONFIG.AXELAR.toChain,
        token:     CONFIG.AXELAR.aUSDC_ADDRESS,
        amount:    CONFIG.AXELAR.amount,
        decimals:  CONFIG.AXELAR.decimals,
        extra: {
          sourceContractAddress:      CONFIG.AXELAR.sourceContractAddress,
          destinationContractAddress: CONFIG.AXELAR.destinationContractAddress,
          tokenSymbol:                "aUSDC",
          tokenAddress:               CONFIG.AXELAR.aUSDC_ADDRESS, // triggers auto-approve
          gasFee:                     feeWithBuffer,
        },
      },
    },
  ]);

  // ── Print results ──────────────────────────────────────────────────────────
  separator("✅  Results");

  const [hop1, hop2] = result.hops;

  const wormholeTx = Array.isArray(hop1.sourceTx) ? hop1.sourceTx[0] : hop1.sourceTx;
  console.log("\n[Hop 1] Wormhole — Polygon Sepolia → Arbitrum Sepolia");
  console.log("  Source TX     :", hop1.sourceTx);
  console.log("  Destination TX:", hop1.destinationTx);
  console.log("  Mode          :", hop1.mode);
  console.log("  Track         :", `https://wormholescan.io/#/tx/${wormholeTx}?network=Testnet`);

  const axelarTx = Array.isArray(hop2.sourceTx) ? hop2.sourceTx[0] : hop2.sourceTx;
  console.log("\n[Hop 2] Axelar — Arbitrum Sepolia → Optimism Sepolia");
  console.log("  Source TX     :", hop2.sourceTx);
  console.log("  Mode          :", hop2.mode);
  console.log("  Track         :", `https://testnet.axelarscan.io/gmp/${axelarTx}`);

  separator("🎉  Done");
}

main().catch((err) => {
  console.error("\n❌  Error:", err.message ?? err);
  process.exit(1);
});