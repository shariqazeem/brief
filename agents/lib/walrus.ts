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
