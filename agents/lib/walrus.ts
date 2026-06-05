// Walrus upload helper. Uses the testnet upload-relay to keep request
// count manageable (without it the SDK fans out ~2200 storage-node
// requests and times out).
//
// Toggle via env: BRIEF_USE_WALRUS=true|false (default false).

import { WalrusClient } from "@mysten/walrus";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

export const WALRUS_TESTNET_RELAY = "https://upload-relay.testnet.walrus.space";
export const WALRUS_TESTNET_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";

export type WalrusUploadResult = {
  blobId: string;
  blobObjectId: string;
  uploadMs: number;
};

let _walrusClient: WalrusClient | null = null;

function getWalrusClient(sui: SuiJsonRpcClient): WalrusClient {
  if (_walrusClient) return _walrusClient;
  _walrusClient = new WalrusClient({
    network: "testnet",
    suiClient: sui as unknown as ConstructorParameters<typeof WalrusClient>[0]["suiClient"],
    uploadRelay: {
      host: WALRUS_TESTNET_RELAY,
      sendTip: { max: 10_000 },
    },
  });
  return _walrusClient;
}

export function walrusEnabled(): boolean {
  return process.env.BRIEF_USE_WALRUS === "true";
}

/**
 * Confirm the signer wallet has at least one WAL coin. Walrus
 * `writeBlob` pays for storage in WAL; if the wallet has none, the SDK
 * throws from a nested async chain that escapes our try/catch as an
 * UnhandledPromiseRejection and crashes the agent. Pre-flighting the
 * balance lets us fall back to inline storage cleanly when the
 * specialist wallet hasn't been topped up with WAL yet.
 */
export async function hasWalrusFunding(
  sui: SuiJsonRpcClient,
  owner: string,
): Promise<boolean> {
  try {
    const coins = await sui.getCoins({
      owner,
      coinType:
        "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL",
    });
    return (coins.data ?? []).some((c) => BigInt(c.balance) > 0n);
  } catch {
    return false;
  }
}

export async function uploadToWalrus(
  payload: Uint8Array,
  sui: SuiJsonRpcClient,
  signer: Ed25519Keypair,
  epochs = 5,
): Promise<WalrusUploadResult> {
  const walrus = getWalrusClient(sui);
  const start = Date.now();
  const result = await walrus.writeBlob({
    blob: payload,
    deletable: false,
    epochs,
    signer,
  });
  return {
    blobId: result.blobId,
    blobObjectId: result.blobObject.id,
    uploadMs: Date.now() - start,
  };
}

/** Build the URL to read a blob from the Walrus aggregator (fast HTTP GET). */
export function walrusReadUrl(blobId: string): string {
  return `${WALRUS_TESTNET_AGGREGATOR}/v1/blobs/${blobId}`;
}
