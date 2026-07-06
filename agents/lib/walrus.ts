// Walrus upload helper. Uses the testnet upload-relay to keep request
// count manageable (without it the SDK fans out ~2200 storage-node
// requests and times out).
//
// Toggle via env: BRIEF_USE_WALRUS=true|false (default false).

import { WalrusClient } from "@mysten/walrus";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const WALRUS_TESTNET_RELAY = "https://upload-relay.testnet.walrus.space";
export const WALRUS_TESTNET_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";

export type WalrusUploadResult = {
  blobId: string;
  blobObjectId: string;
  uploadMs: number;
};

// Walrus is on TESTNET (the free, public Walrus). The trader agent now runs on
// the SUI MAINNET RPC, so we must NOT hand the mainnet client to the Walrus
// client (it would look up the testnet Walrus system objects on mainnet and
// fail). Use a dedicated testnet Sui client for all Walrus interactions. The
// signer (treasury) holds testnet SUI + WAL to pay for storage.
let _walrusSui: SuiJsonRpcClient | null = null;
function walrusSui(): SuiJsonRpcClient {
  if (!_walrusSui) {
    _walrusSui = new SuiJsonRpcClient({
      network: "testnet",
      url: "https://fullnode.testnet.sui.io:443",
    } as unknown as ConstructorParameters<typeof SuiJsonRpcClient>[0]);
  }
  return _walrusSui;
}

let _walrusClient: WalrusClient | null = null;

function getWalrusClient(): WalrusClient {
  if (_walrusClient) return _walrusClient;
  _walrusClient = new WalrusClient({
    network: "testnet",
    suiClient: walrusSui() as unknown as ConstructorParameters<typeof WalrusClient>[0]["suiClient"],
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

/** Minimum summed WAL (in FROST, 1e-9 WAL) required before we ATTEMPT a Walrus
 *  write. One small JSON blob for a few epochs costs ~1.4e6 FROST; we demand a
 *  healthy multi-blob buffer so a write can never leave the wallet below the
 *  NEXT write's cost mid-flight. Override via env. */
const MIN_WAL_FROST = BigInt(process.env.BRIEF_WALRUS_MIN_WAL_FROST ?? "20000000"); // ~0.02 WAL

/**
 * Confirm the signer wallet has ENOUGH WAL to pay for a blob write. Walrus
 * `writeBlob` pays for storage in WAL; if the wallet is short, the SDK throws
 * from a nested async chain that escapes our try/catch as an
 * UnhandledPromiseRejection and CRASHES the agent. A non-zero-but-insufficient
 * balance (drained below one blob's cost) trips this exactly like a zero
 * balance, so we require the SUMMED balance to clear a floor, not merely be > 0.
 * Below it we fall back to inline storage cleanly until the wallet is topped up.
 */
export async function hasWalrusFunding(
  _sui: SuiJsonRpcClient,
  owner: string,
): Promise<boolean> {
  try {
    const coins = await walrusSui().getCoins({
      owner,
      coinType:
        "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL",
    });
    const total = (coins.data ?? []).reduce((sum, c) => sum + BigInt(c.balance), 0n);
    return total >= MIN_WAL_FROST;
  } catch {
    return false;
  }
}

export async function uploadToWalrus(
  payload: Uint8Array,
  _sui: SuiJsonRpcClient,
  signer: Ed25519Keypair,
  epochs = 5,
): Promise<WalrusUploadResult> {
  const walrus = getWalrusClient();
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
