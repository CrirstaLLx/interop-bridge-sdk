import {
  AxelarGMPRecoveryAPI,
  Environment,
} from "@axelar-network/axelarjs-sdk";
import { ethers } from "ethers";

export interface RecoveryParams {
  txHash: string;
  sourceChain: string;
  rpcUrl: string;
  privateKey: string;

  gasLimit?: number;
}

export async function recoverAxelarTransaction(
  params: RecoveryParams
): Promise<{
  status: string;
  action?: "none" | "gas_added" | "manual_relay";
  result?: any;
}> {
  const {
    txHash,
    sourceChain,
    rpcUrl,
    privateKey,
    gasLimit = 700000
  } = params;

  const sdk = new AxelarGMPRecoveryAPI({
    environment: Environment.TESTNET,
  });

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const senderOptions = {
    privateKey,
    provider: provider as any,
  };

  const status = await sdk.queryTransactionStatus(txHash);

  // ✅ already done
  if (status.status === "destination_executed") {
    return {
      status: status.status,
      action: "none"
    };
  }

  // ⚠️ insufficient gas
  if (status.status === "insufficient_fee") {
    const res = await sdk.addNativeGas(
      sourceChain,
      txHash,
      gasLimit,
      { evmWalletDetails: senderOptions }
    );

    return {
      status: status.status,
      action: "gas_added",
      result: res
    };
  }

  // 🔁 fallback → manual relay
  const relay = await sdk.manualRelayToDestChain(
    txHash,
    undefined,
    undefined,
    senderOptions
  );

  return {
    status: status.status,
    action: "manual_relay",
    result: relay
  };
}