import { AxelarQueryAPI, Environment } from "@axelar-network/axelarjs-sdk";
import { ethers } from "ethers";

export interface EstimateAxelarFeeParams {
  sourceChain: string;
  destinationChain: string;
  tokenSymbol: string;

  sourceContractAddress: string;
  destinationContractAddress: string;

  transferAmount: number;

  gasLimit?: number;
  gasMultiplier?: number;
  gasToken?: string;
  executeData?: string;
}

const GAS_TOKENS: Record<string, string> = {
  "ethereum-sepolia": "ETH",
  "optimism-sepolia": "ETH",
  "arbitrum-sepolia": "ETH",
  "polygon-sepolia": "MATIC",
  "base-sepolia": "ETH",
  "linea-sepolia": "ETH",
  "blast-sepolia": "ETH",
  "mantle-sepolia": "MNT",
  "Avalanche": "AVAX",
  "binance": "BNB",
  "Fantom": "FTM",
  "celo-sepolia": "CELO",
  "filecoin-2": "FIL",
  "kava": "KAVA"
};

const L2_CHAINS = [
  "arbitrum-sepolia",
  "optimism-sepolia",
  "base-sepolia",
  "scroll",
  "linea-sepolia",
  "blast-sepolia",
  "mantle-sepolia",
  "fraxtal"
];

function isL2(chain: string): boolean {
  return L2_CHAINS.includes(chain.toLowerCase());
}

export async function estimateAxelarFee(
  params: EstimateAxelarFeeParams
): Promise<{
  raw: any;
  totalWei?: string;
  totalEth?: string;
  usedGasToken: string;
  isDestinationL2: boolean;
}> {
  const api = new AxelarQueryAPI({
    environment: Environment.TESTNET,
  });

  const {
    sourceChain,
    destinationChain,
    tokenSymbol,
    sourceContractAddress,
    destinationContractAddress,
    transferAmount,
    gasLimit = 700000,
    gasMultiplier = 1.2
  } = params;

  // AUTO GAS TOKEN
  const resolvedGasToken =
    params.gasToken || GAS_TOKENS[sourceChain] || "ETH";

  // AUTO EXECUTE DATA
  const resolvedExecuteData =
    params.executeData !== undefined
      ? params.executeData
      : isL2(destinationChain)
      ? "0x1234"
      : "0x";

  const gmpParams = {
    showDetailedFees: true,
    transferAmount,
    destinationContractAddress,
    sourceContractAddress,
    tokenSymbol
  };

  const feeResponse = await api.estimateGasFee(
    sourceChain,
    destinationChain,
    gasLimit,
    gasMultiplier,
    resolvedGasToken,
    "0",
    resolvedExecuteData,
    gmpParams
  );

  if (typeof feeResponse !== "string") {
    const total =
      BigInt(feeResponse.baseFee) +
      BigInt(feeResponse.executionFeeWithMultiplier) +
      BigInt(feeResponse.l1ExecutionFeeWithMultiplier || 0);

    return {
      raw: feeResponse,
      totalWei: total.toString(),
      totalEth: ethers.formatEther(total),
      usedGasToken: resolvedGasToken,
      isDestinationL2: isL2(destinationChain)
    };
  }

  return {
    raw: feeResponse,
    usedGasToken: resolvedGasToken,
    isDestinationL2: isL2(destinationChain)
  };
}