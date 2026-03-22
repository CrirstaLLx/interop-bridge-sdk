// ─────────────────────────────────────────────────────────────────────────────
// AxelarAdapter.ts  –  Wraps AxelarBridge to implement IBridgeAdapter
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";
import { AxelarBridge } from "./AxelarBridge";
import { IBridgeAdapter, TransferRequest, FeeEstimate, TransferResult } from "../types";

// ---------------------------------------------------------------------------
// Axelar-specific extras (typed for convenience, passed via req.extra)
// ---------------------------------------------------------------------------
export interface AxelarExtra {
  /** Address of your deployed Airdrop/Gateway contract on the source chain */
  sourceContractAddress: string;

  /** Address of your deployed contract on the destination chain */
  destinationContractAddress: string;

  /**
   * Axelar token symbol (e.g. "aUSDC").
   * Not the same as the ERC-20 address – Axelar uses its own symbol registry.
   */
  tokenSymbol: string;

  /**
   * Gas fee in ETH to attach to the transaction (e.g. "0.01").
   * Use AxelarBridge.estimateFee() first to get the right value.
   */
  gasFee: string;

  /**
   * Optional list of recipient addresses on the destination chain.
   * Defaults to the signer's own address (single recipient).
   */
  recipients?: string[];
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export class AxelarAdapter implements IBridgeAdapter {
  readonly protocolName = "axelar";

  /**
   * @param signer  ethers.Signer connected to the source network
   */
  constructor(private readonly signer: ethers.Signer) {}

  // ── private helpers ────────────────────────────────────────────────────────

  /** Lazily create the bridge (no async constructor needed) */
  private get bridge(): AxelarBridge {
    return new AxelarBridge(this.signer);
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

  // ── IBridgeAdapter ─────────────────────────────────────────────────────────

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

    // Step 1 – approve token spend if needed
    // tokenAddress must be provided via extra for the approval step
    const tokenAddress = req.extra?.tokenAddress as string | undefined;
    if (tokenAddress) {
      await this.bridge.approve({
        tokenAddress,
        contractAddress: extra.sourceContractAddress,
        amountToSend:    req.amount,
        approveAmount:   req.amount,
        decimals:        req.decimals,
      });
    }

    // Step 2 – execute the cross-chain transfer
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
      protocol:       this.protocolName,
      sourceTx:       result.txHash,
      destinationTx:  null,   // Axelar relayer completes delivery automatically
      mode:           "automatic",
      raw:            result,
    };
  }
}