// ─────────────────────────────────────────────────────────────────────────────
// wormhole/WormholeBridge.ts
//
// Supported protocols:
//   TokenBridge          — manual, user pays gas on both chains (no fee estimate)
//   AutomaticTokenBridge — relayer pays destination (mainnet only)
//   ExecutorTokenBridge  — executor pays destination, precise fee estimate available
// ─────────────────────────────────────────────────────────────────────────────

import {
  Chain,
  Wormhole,
  amount,
  wormhole,
  TokenId,
  TokenTransfer,
} from "@wormhole-foundation/sdk";

import evm    from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import sui    from "@wormhole-foundation/sdk/sui";
import aptos  from "@wormhole-foundation/sdk/aptos";

import { getSigner, getTokenDecimals } from "../utils/signer";
import { attestToken } from "./attestation";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransferParams {
  from:           Chain;
  to:             Chain;
  token:          string;
  amount:         string;
  privateKey:     string;
  protocol?:      "TokenBridge" | "AutomaticTokenBridge" | "ExecutorTokenBridge";
  ensureWrapped?: boolean;
}

export interface ExecutorEstimate {
  msgValue:      bigint;
  gasLimit:      bigint;
  executorQuote: unknown;
  relayFeeWei:   bigint;
  quote:         unknown;
}

// ── WormholeBridge ────────────────────────────────────────────────────────────

export class WormholeBridge {
  private wh!: Wormhole<"Testnet">;

  async init() {
    this.wh = await wormhole("Testnet", [evm, solana, sui, aptos], {
      chains: {
        Solana: { rpc: "https://api.devnet.solana.com" },
      },
    });
  }

  private ensureInitialized() {
    if (!this.wh) {
      throw new Error("[WormholeBridge] Not initialized — call init() first.");
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Estimate fee for a transfer.
   *
   * ExecutorTokenBridge:
   *   Uses estimateMsgValueAndGasLimit() on the destination chain for a
   *   precise on-chain fee quote. Returns relay fee in source native token.
   *
   * TokenBridge / AutomaticTokenBridge:
   *   Falls back to quoteTransfer() — relay fee is 0 for TokenBridge,
   *   and a relay fee for AutomaticTokenBridge (mainnet only).
   */
  async estimate(params: TransferParams): Promise<ExecutorEstimate | unknown> {
    this.ensureInitialized();

    const origChain = this.wh.getChain(params.from);
    const destChain = this.wh.getChain(params.to);
    const protocol  = params.protocol ?? "ExecutorTokenBridge";

    const source      = await getSigner(origChain, params.privateKey);
    const destination = await getSigner(destChain, params.privateKey);

    const tokenId: TokenId = Wormhole.tokenId(params.from, params.token);
    const decimals          = await getTokenDecimals(this.wh, tokenId, origChain);
    const transferAmount    = amount.units(amount.parse(params.amount, decimals));

    if (protocol === "ExecutorTokenBridge") {
      // Build ExecutorTokenBridge transfer object
      const xfer = await this.wh.tokenTransfer(
        tokenId,
        transferAmount,
        source.address,
        destination.address,
        "ExecutorTokenBridge"
      );

      // Get precise destination gas estimate from executor contract
      const dstTb    = await destChain.getExecutorTokenBridge();
      const dstToken = await TokenTransfer.lookupDestinationToken(
        origChain,
        destChain,
        tokenId
      );

      const { msgValue, gasLimit } = await dstTb.estimateMsgValueAndGasLimit(dstToken);

      console.log(`[WormholeBridge] ExecutorTokenBridge gas estimate:`);
      console.log(`  msgValue : ${msgValue} wei`);
      console.log(`  gasLimit : ${gasLimit}`);

      // Build transfer details with gas params for full quote
      const execDetails = {
        token:    xfer.transfer.token,
        amount:   xfer.transfer.amount,
        from:     xfer.transfer.from,
        to:       xfer.transfer.to,
        protocol: "ExecutorTokenBridge" as const,
        msgValue,
        gasLimit,
      };

      const quote = await TokenTransfer.quoteTransfer(
        this.wh,
        origChain,
        destChain,
        execDetails
      );

      const relayFeeWei: bigint = (quote as any)?.relayFee?.amount ?? BigInt(0);

      return {
        msgValue,
        gasLimit,
        executorQuote: (quote as any)?.details?.executorQuote ?? null,
        relayFeeWei,
        quote,
      } satisfies ExecutorEstimate;
    }

    // TokenBridge / AutomaticTokenBridge fallback
    const xfer = await this.wh.tokenTransfer(
      tokenId,
      transferAmount,
      source.address,
      destination.address,
      protocol as any
    );

    return TokenTransfer.quoteTransfer(
      this.wh,
      origChain,
      destChain,
      xfer.transfer as any
    );
  }

  /**
   * Execute a cross-chain token transfer.
   *
   * ExecutorTokenBridge:
   *   Estimates gas, attaches executorQuote, initiates transfer.
   *   Executor handles destination automatically — mode: "automatic".
   *
   * TokenBridge:
   *   Initiates transfer, waits for VAA, completes on destination.
   *   mode: "manual".
   *
   * AutomaticTokenBridge:
   *   Initiates transfer, relayer handles destination.
   *   mode: "automatic".
   */
  async transfer(params: TransferParams) {
    this.ensureInitialized();

    const origChain = this.wh.getChain(params.from);
    const destChain = this.wh.getChain(params.to);
    const protocol  = params.protocol ?? "ExecutorTokenBridge";

    const source      = await getSigner(origChain, params.privateKey);
    const destination = await getSigner(destChain, params.privateKey);

    // ── Balance check ──────────────────────────────────────────────────────
    const tokenId: TokenId = Wormhole.tokenId(params.from, params.token);
    const decimals          = await getTokenDecimals(this.wh, tokenId, origChain);
    const transferAmount    = amount.units(amount.parse(params.amount, decimals));

    const sourceTokenBalance = await origChain.getBalance(
      source.signer.address(),
      tokenId.address
    );

    if (!sourceTokenBalance) {
      throw new Error("[WormholeBridge] Failed to get source token balance");
    }

    if (sourceTokenBalance < transferAmount) {
      throw new Error(
        `[WormholeBridge] Insufficient balance. ` +
        `Have: ${sourceTokenBalance}, need: ${transferAmount}`
      );
    }

    // ── Auto-attestation (TokenBridge only) ───────────────────────────────
    if (protocol === "TokenBridge" && params.ensureWrapped !== false) {
      const tbDest = await destChain.getTokenBridge();
      try {
        await tbDest.getWrappedAsset(tokenId);
        console.log(`✅ Token already wrapped on ${destChain.chain}`);
      } catch {
        console.log(`⚠️ Token NOT wrapped on ${destChain.chain} → running attestation`);
        await attestToken(this.wh, origChain, destChain, tokenId, params.privateKey);
      }
    }

    // ── ExecutorTokenBridge ────────────────────────────────────────────────
    if (protocol === "ExecutorTokenBridge") {
      const xfer = await this.wh.tokenTransfer(
        tokenId,
        transferAmount,
        source.address,
        destination.address,
        "ExecutorTokenBridge"
      );

      // Get precise destination gas estimate
      const dstTb    = await destChain.getExecutorTokenBridge();
      const dstToken = await TokenTransfer.lookupDestinationToken(
        origChain,
        destChain,
        tokenId
      );
      const { msgValue, gasLimit } = await dstTb.estimateMsgValueAndGasLimit(dstToken);

      // Build quote with gas params and attach executorQuote
      const execDetails = {
        token:    xfer.transfer.token,
        amount:   xfer.transfer.amount,
        from:     xfer.transfer.from,
        to:       xfer.transfer.to,
        protocol: "ExecutorTokenBridge" as const,
        msgValue,
        gasLimit,
      };

      const quote = await TokenTransfer.quoteTransfer(
        this.wh,
        origChain,
        destChain,
        execDetails
      );

      // Attach executorQuote — required for initiateTransfer to work
      (xfer.transfer as any).executorQuote = (quote as any)?.details?.executorQuote;

      const srcTxids = await xfer.initiateTransfer(source.signer);

      return {
        sourceTx:      srcTxids,
        destinationTx: null,  // executor handles destination automatically
        quote,
        mode:          "automatic" as const,
      };
    }

    // ── AutomaticTokenBridge ───────────────────────────────────────────────
    if (protocol === "AutomaticTokenBridge") {
      const xfer = await this.wh.tokenTransfer(
        tokenId,
        transferAmount,
        source.address,
        destination.address,
        "AutomaticTokenBridge"
      );

      const quote    = await TokenTransfer.quoteTransfer(this.wh, origChain, destChain, xfer.transfer as any);
      const srcTxids = await xfer.initiateTransfer(source.signer);

      return {
        sourceTx:      srcTxids,
        destinationTx: null,
        quote,
        mode:          "automatic" as const,
      };
    }

    // ── TokenBridge (manual) ───────────────────────────────────────────────
    const xfer = await this.wh.tokenTransfer(
      tokenId,
      transferAmount,
      source.address,
      destination.address,
      "TokenBridge"
    );

    const quote    = await TokenTransfer.quoteTransfer(this.wh, origChain, destChain, xfer.transfer as any);
    const srcTxids = await xfer.initiateTransfer(source.signer);

    await xfer.fetchAttestation(30 * 60 * 1000);
    const destTxids = await xfer.completeTransfer(destination.signer);

    return {
      sourceTx:      srcTxids,
      destinationTx: destTxids,
      quote,
      mode:          "manual" as const,
    };
  }

  async ensureWrappedToken(
    params: Pick<TransferParams, "from" | "to" | "token" | "privateKey">
  ) {
    this.ensureInitialized();

    const origChain = this.wh.getChain(params.from);
    const destChain = this.wh.getChain(params.to);
    const tokenId: TokenId = Wormhole.tokenId(params.from, params.token);

    try {
      const wrapped = await this.wh.getWrappedAsset(destChain.chain, tokenId);
      return { alreadyExisted: true, wrapped };
    } catch {
      const wrapped = await attestToken(
        this.wh, origChain, destChain, tokenId, params.privateKey
      );
      return { alreadyExisted: false, wrapped };
    }
  }
}