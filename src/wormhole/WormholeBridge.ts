// ─────────────────────────────────────────────────────────────────────────────
// wormhole/WormholeBridge.ts
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
  from:          Chain;
  to:            Chain;
  token:         string;
  amount:        string;
  privateKey:    string;   // ← injected by caller, never read from .env
  protocol?:     "TokenBridge" | "AutomaticTokenBridge";
  ensureWrapped?: boolean;
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

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async buildTransfer(
    params:             TransferParams,
    sourceAddress:      any,
    destinationAddress: any
  ) {
    const origChain = this.wh.getChain(params.from);
    const tokenId: TokenId = Wormhole.tokenId(params.from, params.token);
    const decimals = await getTokenDecimals(this.wh, tokenId, origChain);

    const transferAmount = amount.units(amount.parse(params.amount, decimals));
    const protocol = params.protocol ?? "TokenBridge";

    let xfer: TokenTransfer<"Testnet">;

    if (protocol === "TokenBridge") {
      xfer = await this.wh.tokenTransfer(
        tokenId, transferAmount, sourceAddress, destinationAddress, "TokenBridge"
      );
    } else if (protocol === "AutomaticTokenBridge") {
      xfer = await this.wh.tokenTransfer(
        tokenId, transferAmount, sourceAddress, destinationAddress, "AutomaticTokenBridge"
      );
    } else {
      throw new Error(`[WormholeBridge] Unsupported protocol: ${protocol}`);
    }

    return { xfer, tokenId, decimals, transferAmount, protocol };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async estimate(params: TransferParams) {
    this.ensureInitialized();

    const origChain = this.wh.getChain(params.from);
    const destChain = this.wh.getChain(params.to);

    const source      = await getSigner(origChain, params.privateKey);
    const destination = await getSigner(destChain, params.privateKey);

    const { xfer } = await this.buildTransfer(params, source.address, destination.address);

    return TokenTransfer.quoteTransfer(
      this.wh,
      origChain,
      destChain,
      xfer.transfer as any
    );
  }

  async transfer(params: TransferParams) {
    this.ensureInitialized();

    const origChain = this.wh.getChain(params.from);
    const destChain = this.wh.getChain(params.to);

    const source      = await getSigner(origChain, params.privateKey);
    const destination = await getSigner(destChain, params.privateKey);

    // ── Balance check ──────────────────────────────────────────────────────
    const tokenId: TokenId = Wormhole.tokenId(params.from, params.token);
    const decimals = await getTokenDecimals(this.wh, tokenId, origChain);

    const sourceTokenBalance = await origChain.getBalance(
      source.signer.address(),
      tokenId.address
    );

    if (!sourceTokenBalance) {
      throw new Error("[WormholeBridge] Failed to get source token balance");
    }

    const transferAmount = amount.units(amount.parse(params.amount, decimals));

    if (sourceTokenBalance < transferAmount) {
      throw new Error(
        `[WormholeBridge] Insufficient balance. ` +
        `Have: ${sourceTokenBalance}, need: ${transferAmount}`
      );
    }

    // ── Auto-attestation if token not wrapped on destination ───────────────
    if (params.ensureWrapped !== false) {
      const tbDest = await destChain.getTokenBridge();
      try {
        await tbDest.getWrappedAsset(tokenId);
        console.log(`✅ Token already wrapped on ${destChain.chain}`);
      } catch {
        console.log(`⚠️ Token NOT wrapped on ${destChain.chain} → running attestation`);
        await attestToken(this.wh, origChain, destChain, tokenId, params.privateKey);
      }
    }

    // ── Build and initiate transfer ────────────────────────────────────────
    const { xfer, protocol } = await this.buildTransfer(
      params,
      source.address,
      destination.address
    );

    const quote = await TokenTransfer.quoteTransfer(
      this.wh,
      origChain,
      destChain,
      xfer.transfer as any
    );

    const srcTxids = await xfer.initiateTransfer(source.signer);

    // AutomaticTokenBridge — relayer completes destination, return immediately
    if (protocol === "AutomaticTokenBridge") {
      return { sourceTx: srcTxids, destinationTx: null, quote, mode: "automatic" as const };
    }

    // TokenBridge — wait for VAA then complete transfer on destination
    await xfer.fetchAttestation(30 * 60 * 1000);
    const destTxids = await xfer.completeTransfer(destination.signer);

    return { sourceTx: srcTxids, destinationTx: destTxids, quote, mode: "manual" as const };
  }

  async ensureWrappedToken(params: Pick<TransferParams, "from" | "to" | "token" | "privateKey">) {
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