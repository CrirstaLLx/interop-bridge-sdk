// ─────────────────────────────────────────────────────────────────────────────
// wormhole/attestation.ts
//
// Attest a token on the source chain so it can be wrapped on the destination.
// Called automatically by WormholeBridge.transfer() when ensureWrapped = true.
// ─────────────────────────────────────────────────────────────────────────────

import { Wormhole, TokenId, signSendWait } from "@wormhole-foundation/sdk";
import { getSigner } from "../utils/signer";

/**
 * Attest a token from origChain so it becomes available (wrapped) on destChain.
 * If the token is already wrapped, returns immediately without any transactions.
 *
 * @param wh         Initialized Wormhole instance
 * @param origChain  Source chain context
 * @param destChain  Destination chain context
 * @param tokenId    Token to attest
 * @param privateKey Signer private key (same wallet used for transfers)
 */
export async function attestToken<N extends "Testnet">(
  wh:         Wormhole<N>,
  origChain:  any,
  destChain:  any,
  tokenId:    TokenId,
  privateKey: string
) {
  console.log("⚠️ Starting attestation...");

  const { signer: origSigner } = await getSigner(origChain, privateKey);
  const { signer: destSigner } = await getSigner(destChain, privateKey, BigInt(2_500_000));

  const tbOrig = await origChain.getTokenBridge();
  const tbDest = await destChain.getTokenBridge();

  // Check if already wrapped — skip attestation if so
  try {
    const wrapped = await tbDest.getWrappedAsset(tokenId);
    console.log("✅ Token already wrapped:", wrapped);
    return wrapped;
  } catch {
    console.log("❌ Token not wrapped yet → continuing attestation");
  }

  // 1️⃣ Create attestation on source chain
  const attestTxns = tbOrig.createAttestation(
    tokenId.address,
    Wormhole.parseAddress(origSigner.chain(), origSigner.address())
  );

  const txids = await signSendWait(origChain, attestTxns, origSigner);
  const txid  = txids[0]?.txid;

  if (!txid) throw new Error("Failed to create attestation transaction");
  console.log("✅ Attestation TX:", txid);

  // 2️⃣ Parse the attestation message
  const msgs = await origChain.parseTransaction(txid);
  if (!msgs || !msgs[0]) throw new Error("Failed to parse attestation transaction");

  // 3️⃣ Fetch VAA from Wormhole guardians (waits up to 25 min)
  const vaa = await wh.getVaa(msgs[0], "TokenBridge:AttestMeta", 25 * 60 * 1000);
  if (!vaa) throw new Error("VAA not found");

  // 4️⃣ Submit attestation on destination chain
  const subTx = tbDest.submitAttestation(
    vaa,
    Wormhole.parseAddress(destSigner.chain(), destSigner.address())
  );
  await signSendWait(destChain, subTx, destSigner);
  console.log("✅ Attestation submitted");

  // 5️⃣ Poll until wrapped token is confirmed on destination
  for (let i = 0; i < 60; i++) {
    try {
      const wrapped = await tbDest.getWrappedAsset(tokenId);
      console.log("🎉 Wrapped token ready:", wrapped);
      return wrapped;
    } catch {
      console.log("⏳ Waiting for wrapped token...");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  throw new Error("Wrapped token was not created in time");
}