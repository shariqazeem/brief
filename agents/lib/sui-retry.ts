// Retry-on-conflict for Sui transactions signed by a long-lived wallet.
//
// The Planner wallet ends up signing many things close together (posting
// sub-tasks, auto-approving settlements, posting kill-switch verification
// tasks, settling the user-driven Release). The @mysten/sui SDK caches
// the wallet's gas coin and its version; when two txs land back-to-back
// the second can hit a "version mismatch" / "not available for
// consumption" / equivocation error because the SDK still holds the
// stale version.
//
// CRITICAL #1 — caching: @mysten/sui's Transaction object caches its
// serialized bytes after the first build, so retrying with the SAME
// Transaction instance reuses the stale gas. To force a fresh build
// (and a fresh gas-coin selection from the wallet's current coin set)
// the caller passes a `buildTx()` function — we re-invoke it on every
// attempt.
//
// CRITICAL #2 — idempotency: some retryable error signatures
// ("could not find the referenced object", "current version:") can
// occur AFTER a transaction has already executed and landed on chain —
// the failure is in the response read-back, not in the execution. A
// blind retry then re-executes a mutation that's already done, and the
// second attempt aborts with a misleading fingerprint (e.g., a submit
// retry seeing the task already in DELIVERED → EWrongStatus, when the
// real path was a successful first attempt).
//
// The fix: callers can pass an `alreadyDone(): Promise<…>` post-state
// check. After a retryable error, we call it; if the chain already
// reflects the intended effect, we return success WITHOUT re-executing.
// Move aborts (EPolicyRevoked, EWrongStatus, etc.) still bypass the
// retry entirely so the abort-fingerprint parsing keeps working.
//
// Used by the planner CLI, the approve / post / revoke scripts, and the
// specialist deliver paths.

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

/**
 * Result of an idempotency check. Returned by `alreadyDone` to tell the
 * retry helper whether the original tx's effects already landed.
 *
 *   - `null`: effect did not land — safe to retry.
 *   - `"done"`: effect landed; the helper synthesizes a minimal success
 *               response (no digest known).
 *   - `SuiTransactionBlockResponse`: effect landed and the caller
 *                                    already constructed (or fetched)
 *                                    the full response — return it.
 */
export type AlreadyDoneResult =
  | null
  | "done"
  | SuiTransactionBlockResponse;

export type SignWithRetryOpts = {
  /** How many total attempts (including the first). Default 3. */
  attempts?: number;
  /** Linear base backoff in ms; nth retry waits ~n * baseBackoffMs + jitter. Default 700. */
  baseBackoffMs?: number;
  /** Log prefix, e.g. "planner:post-all". */
  label?: string;
  /**
   * Idempotency check called BEFORE every retry. Use this to ask the
   * chain whether the intended on-chain effect of the previous attempt
   * already landed — if so we short-circuit to success instead of
   * re-executing the mutation.
   *
   * For mutating workforce ops the right check is the post-state shape:
   *   - accept           → fetchTask().status === ACCEPTED
   *                        && assignedTo === ctx.address
   *   - submit           → fetchTask().status ∈ {DELIVERED, APPROVED}
   *                        && deliverableId set
   *   - approve          → fetchTask().status === APPROVED (or EXPIRED)
   *   - one-PTB N posts  → N matching TaskPosted events for this
   *                        (poster, parent_policy, posted_at window)
   *   - single post      → ≥1 matching TaskPosted event for
   *                        (poster, assigned_to, capability, window)
   */
  alreadyDone?: () => Promise<AlreadyDoneResult>;
};

function syntheticSuccessResponse(label: string): SuiTransactionBlockResponse {
  // Callers branch on `effects.status.status === "success"`; the digest
  // is informational only on the idempotent path (the real digest of the
  // landed tx is recoverable via a chain query if anyone needs it).
  return {
    digest: `(idempotent:${label})`,
    effects: { status: { status: "success" } },
  } as unknown as SuiTransactionBlockResponse;
}

/**
 * signAndExecuteTransaction(...) with retry-on-coin-race AND
 * caller-driven idempotency. The caller provides:
 *   - a `buildTx()` function (or a Transaction) — we INVOKE IT FRESH on
 *     every retry so a rebuild uses current gas (the SDK caches built
 *     bytes per Transaction instance; reusing it reuses the stale gas
 *     that caused the race).
 *   - an optional `alreadyDone()` post-state check — see SignWithRetryOpts.
 *
 * Throws on the final attempt or on any non-race error (Move aborts,
 * validator rejections, etc.) so callers' abort-fingerprint parsing
 * still works.
 */
export async function signAndExecuteWithRetry(
  ctx: AgentContext,
  buildTx: (() => Transaction) | Transaction,
  options: SuiTransactionBlockResponseOptions,
  opts: SignWithRetryOpts = {},
): Promise<SuiTransactionBlockResponse> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseBackoffMs ?? 700;
  const label = opts.label ?? "tx";
  const builder = typeof buildTx === "function" ? buildTx : () => buildTx;

  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const tx = builder();
      return await ctx.client.signAndExecuteTransaction({
        signer: ctx.keypair,
        transaction: tx,
        options,
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = isRetryable(msg);
      if (!retryable) {
        // Move aborts (EPolicyRevoked etc.) reach here — never retry.
        throw e;
      }

      // BEFORE retrying, ask the caller whether the effect already
      // landed. Some retryable errors come back AFTER successful
      // execution (read-back / propagation lag), and double-executing
      // a mutation is the bug that bit Run #3 of P6.
      if (opts.alreadyDone) {
        try {
          const r = await opts.alreadyDone();
          if (r === "done") {
            console.log(
              `[${label}] idempotency check: effect already landed on chain (suppressed retryable error: "${msg.slice(0, 100).replace(/\n/g, " ")}") — short-circuiting to success`,
            );
            return syntheticSuccessResponse(label);
          }
          if (r && typeof r === "object" && "digest" in r) {
            const digest = (r as { digest?: string }).digest ?? "?";
            console.log(
              `[${label}] idempotency check: effect already landed (tx=${typeof digest === "string" ? digest.slice(0, 12) : "?"}…) — returning the on-chain response`,
            );
            return r as SuiTransactionBlockResponse;
          }
          // r === null → not done, fall through and retry.
        } catch (chainErr) {
          const cm = chainErr instanceof Error ? chainErr.message : String(chainErr);
          console.warn(
            `[${label}] idempotency check threw (${cm.slice(0, 100)}) — will retry conservatively`,
          );
        }
      }

      if (i === attempts) {
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
