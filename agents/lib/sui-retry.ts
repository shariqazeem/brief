// Retry-on-conflict for Sui transactions signed by a long-lived wallet.
//
// The Planner wallet ends up signing many things close together (posting
// sub-tasks, auto-approving settlements, posting kill-switch verification
// tasks, settling the user-driven Release). The @mysten/sui SDK caches
// the wallet's gas coin and its version; when two txs land back-to-back
// the second can hit a "version mismatch" / "not available for
// consumption" / equivocation error because the SDK still holds the
// stale version. The chain itself is fine — we just need to refetch and
// retry. This helper does that:
//
//   1. Catch the specific error signatures (regex on message).
//   2. Sleep with linear backoff + jitter.
//   3. Re-build is not needed — calling signAndExecuteTransaction with
//      the SAME Transaction triggers the SDK to fetch fresh coins on
//      every call, so a retry uses fresh gas. (The Transaction is
//      built-but-not-signed until the call.)
//
// Used by the planner CLI, the approve / post / revoke scripts, and the
// inside-process planner-service loop.

import type { Transaction } from "@mysten/sui/transactions";
import type {
  SuiTransactionBlockResponse,
  SuiTransactionBlockResponseOptions,
} from "@mysten/sui/jsonRpc";

import type { AgentContext } from "./sui.js";

// Error signatures we will retry on. Sui SDK + fullnode error messages
// vary by node, so we cast a wide net but stay specific to coin/version
// races — never retry programming errors like Move aborts.
const RACE_SIGNATURES = [
  // SDK-side stale cache
  /not\s+available\s+for\s+consumption/i,
  /current\s+version:/i,
  /needs\s+to\s+be\s+rebuilt\s+because/i,
  /referenced\s+input\s+object/i,
  // Validator-side equivocation
  /equivocat/i,
  // RPC propagation while we ride between nodes
  /could\s+not\s+find\s+the\s+referenced\s+object/i,
];

function isRetryable(msg: string): boolean {
  return RACE_SIGNATURES.some((re) => re.test(msg));
}

export type SignWithRetryOpts = {
  /** How many total attempts (including the first). Default 3. */
  attempts?: number;
  /** Linear base backoff in ms; nth retry waits ~n * baseBackoffMs + jitter. Default 700. */
  baseBackoffMs?: number;
  /** Log prefix, e.g. "planner:post-all". */
  label?: string;
};

/**
 * signAndExecuteTransaction(...) with retry-on-coin-race. Throws on the
 * final attempt or on any non-race error (Move aborts, validator
 * rejections, etc.) so callers' abort-fingerprint parsing still works.
 */
export async function signAndExecuteWithRetry(
  ctx: AgentContext,
  tx: Transaction,
  options: SuiTransactionBlockResponseOptions,
  opts: SignWithRetryOpts = {},
): Promise<SuiTransactionBlockResponse> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseBackoffMs ?? 700;
  const label = opts.label ?? "tx";

  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await ctx.client.signAndExecuteTransaction({
        signer: ctx.keypair,
        transaction: tx,
        options,
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = isRetryable(msg);
      if (!retryable || i === attempts) {
        throw e;
      }
      const backoffMs = base * i + Math.floor(Math.random() * 350);
      console.warn(
        `[${label}] coin/version race on attempt ${i}/${attempts} — retrying in ${backoffMs}ms (${msg.slice(0, 160).replace(/\n/g, " ")})`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}
