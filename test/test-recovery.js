require("dotenv").config();

const { recoverAxelarTransaction } = require("../dist/axelar/recovery");

async function run() {
  const result = await recoverAxelarTransaction({
    txHash: "0x1c5614159954b62a9e97a4c9634a5c23e645eb7278faf77466fe4d41d0318d32",
    sourceChain: "ethereum-sepolia",
    rpcUrl: process.env.RPC_SEPOLIA,
    privateKey: process.env.PRIVATE_KEY
  });

  console.log("Recovery result:");
  console.log(result);
}

run().catch(console.error);