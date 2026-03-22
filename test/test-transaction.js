require("dotenv").config();

const { AxelarBridge } = require("../dist");
const { ethers } = require("ethers");

async function run() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_SEPOLIA);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const bridge = new AxelarBridge(wallet);

  const amount = "0.01";

  const params = {
    sourceChain: "ethereum-sepolia",
    destinationChain: "optimism-sepolia",

    sourceContractAddress: "0xAe809E3bbC80090920aAb24675702932619DCf2e",
    destinationContractAddress: "0xE816791A620506c6A1da03b491221e2E89dd528e",

    tokenSymbol: "aUSDC",
    transferAmount: Number(amount)
  };

  console.log("🔍 Estimating fee...");

  const fee = await bridge.estimateFee(params);

  console.log("Fee:", fee);

  if (!fee.totalWei) {
    throw new Error("Failed to estimate fee");
  }

  // 🔥 APPROVE
  console.log("📝 Checking / approving token...");

  await bridge.approve({
    tokenAddress: "0x254d06f33bDc5b8ee05b2ea472107E300226659A", // aUSDC Sepolia
    contractAddress: params.sourceContractAddress,
    amountToSend: amount,
    approveAmount: "1",
    decimals: 6
  });

  console.log("✅ Approval done");

  // 🔥 TRANSFER
  console.log("🚀 Sending cross-chain transfer...");

  const result = await bridge.transfer({
    ...params,
    amount,
    decimals: 6,
    recipients: [wallet.address],
    gasFee: fee.totalEth
  });

  console.log("TX hash:", result.txHash);

  console.log("✅ Bridge initiated");
}

run().catch(console.error);