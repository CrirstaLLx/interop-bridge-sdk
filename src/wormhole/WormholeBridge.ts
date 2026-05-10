// WormholeBridge.ts
//
// Three sub-protocols, each with different delivery mechanics:
//   TokenBridge          — manual; SDK initiates on source, waits for VAA, completes on dest
//   AutomaticTokenBridge — relayer completes delivery (mainnet only, no testnet support)
//   ExecutorTokenBridge  — executor contract pays dest gas; best option for fee estimation

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

  // Fee estimation strategy depends on the protocol:
  //
  //   ExecutorTokenBridge — calls estimateMsgValueAndGasLimit() on the destination
  //     executor contract for a precise on-chain quote. relayFee.amount from the
  //     resulting quote is what the executor charges (shown as "Amount Paid" on Wormholescan).
  //
  //   TokenBridge / AutomaticTokenBridge — falls back to quoteTransfer().
  //     TokenBridge returns relay fee 0 (user pays dest gas themselves).
  //     AutomaticTokenBridge returns a relay fee (mainnet only).
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
      const xfer = await this.wh.tokenTransfer(
        tokenId,
        transferAmount,
        source.address,
        destination.address,
        "ExecutorTokenBridge"
      );

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

  // Transfer execution. Mode determines who completes the destination side:
  //
  //   ExecutorTokenBridge — executor contract handles it automatically.
  //     We need to attach executorQuote to the transfer before initiating,
  //     otherwise the executor contract rejects the transaction.
  //
  //   TokenBridge — we complete it manually: initiate → wait for VAA → redeem on dest.
  //     fetchAttestation() polls the Wormhole Guardian network for the VAA.
  //
  //   AutomaticTokenBridge — relayer handles dest; we only initiate.
  async transfer(params: TransferParams) {
    this.ensureInitialized();

    const origChain = this.wh.getChain(params.from);
    const destChain = this.wh.getChain(params.to);
    const protocol  = params.protocol ?? "ExecutorTokenBridge";

    const source      = await getSigner(origChain, params.privateKey);
    const destination = await getSigner(destChain, params.privateKey);

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

    // Auto-attestation — only relevant for TokenBridge.
    // If the token has never been bridged to the destination before, Wormhole
    // won't have a wrapped asset for it and the transfer will fail. attestToken()
    // creates that wrapped representation first.
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

    if (protocol === "ExecutorTokenBridge") {
      const xfer = await this.wh.tokenTransfer(
        tokenId,
        transferAmount,
        source.address,
        destination.address,
        "ExecutorTokenBridge"
      );

      const dstTb    = await destChain.getExecutorTokenBridge();
      const dstToken = await TokenTransfer.lookupDestinationToken(
        origChain,
        destChain,
        tokenId
      );
      const { msgValue, gasLimit } = await dstTb.estimateMsgValueAndGasLimit(dstToken);

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

      // executorQuote must be attached before initiateTransfer — the executor
      // contract checks for it and rejects the TX if it's missing.
      (xfer.transfer as any).executorQuote = (quote as any)?.details?.executorQuote;

      const srcTxids = await xfer.initiateTransfer(source.signer);

      return {
        sourceTx:      srcTxids,
        destinationTx: null,
        quote,
        mode:          "automatic" as const,
      };
    }

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

    // TokenBridge (manual): initiate → fetch VAA from Guardians → redeem on destination.
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