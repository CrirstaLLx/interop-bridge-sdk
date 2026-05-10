// AxelarAdapter.ts — wraps AxelarBridge to implement IBridgeAdapter

import { ethers } from "ethers";
import { AxelarBridge } from "./AxelarBridge";
import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "../types";

// Protocol-specific extras passed via req.extra.
// When called through BridgeSDK.sendTransfer(), these are injected automatically
// from chains.ts. Only needed manually when using AxelarAdapter directly.
export interface AxelarExtra {
  sourceContractAddress:      string;  // your deployed Airdrop/Gateway contract on source chain
  destinationContractAddress: string;  // your deployed contract on destination chain
  tokenSymbol:                string;  // Axelar token symbol, e.g. "aUSDC" (not an ERC-20 address)
  gasFee:                     string;  // native token fee to attach, e.g. "0.01" — get from estimateFee() first
  tokenAddress?:              string;  // aUSDC contract address on source chain, used for approve()
  recipients?:                string[]; // defaults to signer's own address
}

export class AxelarAdapter implements IBridgeAdapter {
  readonly protocolName = "axelar";

  // Created lazily on first use; safe to reuse because AxelarBridge is stateless.
  private _bridge?: AxelarBridge;

  constructor(private readonly signer: ethers.Signer) {}

  private get bridge(): AxelarBridge {
    return (this._bridge ??= new AxelarBridge(this.signer));
  }

  private requireExtra(req: TransferRequest): AxelarExtra {
    if (!req.extra) {
      throw new Error(
        "[AxelarAdapter] req.extra is required. " +
        "Provide { sourceContractAddress, destinationContractAddress, tokenSymbol, gasFee }."
      );
    }
    const e = req.extra as Partial<AxelarExtra>;
    if (!e.sourceContractAddress)      throw new Error("[AxelarAdapter] extra.sourceContractAddress is missing");
    if (!e.destinationContractAddress) throw new Error("[AxelarAdapter] extra.destinationContractAddress is missing");
    if (!e.tokenSymbol)                throw new Error("[AxelarAdapter] extra.tokenSymbol is missing");
    if (!e.gasFee)                     throw new Error("[AxelarAdapter] extra.gasFee is missing");
    return e as AxelarExtra;
  }

  async estimateFee(req: TransferRequest): Promise<FeeEstimate> {
    const extra = this.requireExtra(req);

    const result = await this.bridge.estimateFee({
      sourceChain:                req.fromChain,
      destinationChain:           req.toChain,
      tokenSymbol:                extra.tokenSymbol,
      sourceContractAddress:      extra.sourceContractAddress,
      destinationContractAddress: extra.destinationContractAddress,
      transferAmount:             parseFloat(req.amount),
    });

    return {
      protocol:  this.protocolName,
      fee:       result.totalEth ?? "unknown",
      feeToken:  result.usedGasToken,
      raw:       result.raw,
    };
  }

  async transfer(req: TransferRequest): Promise<TransferResult> {
    const extra = this.requireExtra(req);

    // Approve token spend before the transfer.
    // tokenAddress is injected from chains.ts by BridgeSDK; supply it manually
    // when calling this adapter directly without going through BridgeSDK.
    const tokenAddress = extra.tokenAddress;
    if (tokenAddress) {
      await this.bridge.approve({
        tokenAddress,
        contractAddress: extra.sourceContractAddress,
        amountToSend:    req.amount,
        approveAmount:   req.amount,
        decimals:        req.decimals,
      });
    }

    const result = await this.bridge.transfer({
      sourceContractAddress:      extra.sourceContractAddress,
      destinationChain:           req.toChain,
      destinationContractAddress: extra.destinationContractAddress,
      tokenSymbol:                extra.tokenSymbol,
      amount:                     req.amount,
      decimals:                   req.decimals,
      gasFee:                     extra.gasFee,
      recipients:                 extra.recipients,
    });

    return {
      protocol:      this.protocolName,
      sourceTx:      result.txHash,
      destinationTx: null,   // relayer handles destination delivery
      mode:          "automatic",
      raw:           result,
    };
  }
}