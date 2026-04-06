import { AxelarQueryAPI, Environment } from "@axelar-network/axelarjs-sdk";
import { ethers } from "ethers";
import { getNativeToken, getChain } from "../chains";

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

// Derives from chains.ts — no local duplicate needed
function isL2(chain: string): boolean {
  return getChain(chain)?.isL2 === true;
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

  // Resolve gas token from chains.ts — falls back to "ETH" if unknown.
  // Caller can override via params.gasToken.
  const resolvedGasToken = params.gasToken || getNativeToken(sourceChain);

  // L2 destinations need non-empty executeData for accurate fee estimation
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
      raw:             feeResponse,
      totalWei:        total.toString(),
      totalEth:        ethers.formatEther(total),
      usedGasToken:    resolvedGasToken,
      isDestinationL2: isL2(destinationChain),
    };
  }

  return {
    raw:             feeResponse,
    usedGasToken:    resolvedGasToken,
    isDestinationL2: isL2(destinationChain),
  };
}