require("dotenv").config();

const { AxelarBridge } = require("../dist");
const { ethers } = require("ethers");

const TOKENS = {
  "Ethereum Sepolia": "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
  "Optimism Sepolia": "0x254d06f33bDc5b8ee05b2ea472107E300226659A" // dopln
};

async function test(chainRpc, name) {
  const provider = new ethers.JsonRpcProvider(chainRpc);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const bridge = new AxelarBridge(wallet);

  const balance = await bridge.getBalance({
    tokenAddress: TOKENS[name],
    decimals: 6
  });

  console.log(name, balance);
}

async function run() {
  await test(process.env.RPC_SEPOLIA, "Ethereum Sepolia");
  await test(process.env.RPC_OPTIMISM, "Optimism Sepolia");
}

run();