// ─────────────────────────────────────────────────────────────────────────────
// utils/signer.ts
//
// Signer factory for Wormhole SDK.
// privateKey is always passed as a parameter — never read from .env directly.
// This makes the SDK usable by any consumer without forcing .env conventions.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ChainAddress,
  ChainContext,
  Network,
  Signer,
  Wormhole,
  Chain,
  TokenId,
  isTokenId,
} from "@wormhole-foundation/sdk";
import evm    from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import sui    from "@wormhole-foundation/sdk/sui";
import aptos  from "@wormhole-foundation/sdk/aptos";

export interface SignerStuff<N extends Network, C extends Chain> {
  chain:   ChainContext<N, C>;
  signer:  Signer<N, C>;
  address: ChainAddress<C>;
}

/**
 * Create a Wormhole-compatible signer for any supported platform.
 *
 * @param chain      Wormhole ChainContext (from wh.getChain())
 * @param privateKey Raw private key string — caller is responsible for sourcing it securely
 * @param gasLimit   Optional gas limit override (useful for destination chain txs)
 */
export async function getSigner<N extends Network, C extends Chain>(
  chain:      ChainContext<N, C>,
  privateKey: string,
  gasLimit?:  bigint
): Promise<{ chain: ChainContext<N, C>; signer: Signer<N, C>; address: ChainAddress<C> }> {
  let signer: Signer;
  const platform = chain.platform.utils()._platform;

  switch (platform) {
    case "Evm": {
      const opts = gasLimit ? { gasLimit } : {};
      signer = await (await evm()).getSigner(await chain.getRpc(), privateKey, opts);
      break;
    }
    case "Solana":
      signer = await (await solana()).getSigner(await chain.getRpc(), privateKey);
      break;
    case "Sui":
      signer = await (await sui()).getSigner(await chain.getRpc(), privateKey);
      break;
    case "Aptos":
      signer = await (await aptos()).getSigner(await chain.getRpc(), privateKey);
      break;
    default:
      throw new Error(`[getSigner] Unsupported platform: ${platform}`);
  }

  return {
    chain,
    signer:  signer as Signer<N, C>,
    address: Wormhole.chainAddress(chain.chain, signer.address()),
  };
}

/**
 * Resolve token decimals — works for both token addresses and native tokens.
 */
export async function getTokenDecimals<N extends "Mainnet" | "Testnet" | "Devnet">(
  wh:        Wormhole<N>,
  token:     TokenId,
  sendChain: ChainContext<N, any>
): Promise<number> {
  return isTokenId(token)
    ? Number(await wh.getDecimals(token.chain, token.address))
    : sendChain.config.nativeTokenDecimals;
}