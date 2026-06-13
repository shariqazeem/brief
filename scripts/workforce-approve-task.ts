// CLI: approve a delivered task.
//
// Usage:
//   tsx --env-file=.env.local scripts/workforce-approve-task.ts \
//     --task 0x... [--policy 0x...] [--agent-reg 0x...]
//
// If --policy is supplied, calls task::approve_with_policy (atomic with
// operator_policy::record_spend). Otherwise calls task::approve_direct.
//
// --agent-reg can be omitted; the script discovers the agent's
// AgentRegistration by walking AgentRegistered events for task.assigned_to.

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext, makeAgentContextFor } from "../agents/lib/sui.js";
import { signAndExecuteWithRetry } from "../agents/lib/sui-retry.js";
import {
  buildApproveWithPolicyTx,
  buildApproveDirectTx,
  fetchTask,
} from "../agents/workforce/lib/task.js";
import { findAgentRegistration } from "../agents/workforce/lib/agent-registry.js";

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.task) {
    console.error("Missing --task");
    process.exit(1);
  }

  const env = loadEnv();
  // Trader-product tasks are posted by Treasury (== policy.agent), so
  // approve_with_policy must be signed by Treasury too (sender ==
  // task.poster AND record_spend sender == policy.agent). `--as treasury`
  // selects that wallet; default stays the Planner for the legacy path.
  const ctx =
    args.as === "treasury"
      ? makeAgentContextFor(env, "treasury")
      : makeAgentContext(env);

  const t = await fetchTask(ctx, args.task);
  console.log(
    `[approve] task ${t.id.slice(0, 10)}… status=${t.status} bounty=${t.bountyAmount} assigned_to=${t.assignedTo.slice(0, 10)}…`,
  );

  if (t.status !== "delivered") {
    console.error(`Cannot approve — task status is ${t.status}, must be delivered`);
    process.exit(1);
  }

  let agentRegId = args["agent-reg"];
  if (!agentRegId) {
    console.log(`[approve] looking up AgentRegistration for ${t.assignedTo.slice(0, 10)}…`);
    const reg = await findAgentRegistration(ctx, t.assignedTo);
    if (!reg) {
      console.error("No AgentRegistration found on chain for the assigned agent.");
      process.exit(1);
    }
    agentRegId = reg.id;
  }

  const policyId = args.policy ?? t.parentPolicy;
  const usingPolicy = policyId && policyId !== "true";
  const buildTx = () =>
    usingPolicy
      ? buildApproveWithPolicyTx(ctx, {
          taskId: t.id,
          policyId,
          agentRegId,
        })
      : buildApproveDirectTx(ctx, {
          taskId: t.id,
          agentRegId,
        });

  console.log(
    `[approve] sending ${usingPolicy ? "approve_with_policy" : "approve_direct"} · policy=${policyId?.slice(0, 10) ?? "none"} reg=${agentRegId.slice(0, 10)}…`,
  );

  let res;
  try {
    res = await signAndExecuteWithRetry(
      ctx,
      buildTx,
      { showEffects: true, showEvents: true, showBalanceChanges: true },
      {
        label: "approve-task",
        attempts: 3,
        // Idempotency: a retryable error after a successful approve
        // means the task is already APPROVED (or EXPIRED). The chain
        // would refuse a second approve with EWrongStatus, masking the
        // real "it already succeeded" outcome.
        alreadyDone: async () => {
          try {
            const cur = await fetchTask(ctx, t.id);
            if (cur.status === "approved" || cur.status === "expired") {
              return "done";
            }
          } catch {
            /* fall through */
          }
          return null;
        },
      },
    );
  } catch (e) {
    reportAbort(env.network, e);
    process.exit(1);
  }

  if (res.effects?.status?.status !== "success") {
    reportAbort(env.network, {
      message: res.effects?.status?.error ?? "unknown abort",
      digest: res.digest,
    });
    process.exit(1);
  }

  console.log(`[approve] ok · tx=${res.digest}`);
  const explorer = `https://suiscan.xyz/${env.network}/tx/${res.digest}`;
  console.log(`[approve] explorer=${explorer}`);
}

// Map Move abort codes back to the constant names declared in our modules.
// Format we extract from: "MoveAbort(MoveLocation { module: ModuleId { ... }, function: 12, instruction: 24, function_name: Some(\"record_spend\") }, 3) in command 0"
const ABORT_CODES: Record<string, Record<number, string>> = {
  operator_policy: {
    1: "ENotOwner",
    2: "ENotAgent",
    3: "EPolicyRevoked",
    4: "EPolicyExpired",
    5: "EBudgetExceeded",
    6: "EVenueNotAllowed",
    7: "EInvalidConfig",
    8: "ECannotShrink",
  },
  task: {
    1: "ENotPoster",
    2: "ENotAssignedAgent",
    3: "EWrongStatus",
    4: "EDeadlinePassed",
    5: "EDeadlineNotReached",
    6: "EInvalidConfig",
    7: "EAgentMismatch",
    8: "EPolicyMismatch",
    9: "EPolicyRequired",
    10: "EPolicyNotAllowed",
  },
};

function reportAbort(network: string, e: unknown): void {
  const anyE = e as { message?: string; digest?: string; cause?: unknown };
  const raw = typeof anyE.message === "string" ? anyE.message : String(e);
  const digest = anyE.digest;

  // SDK format A (Transaction resolution failed):
  //   "MoveAbort in 1st command, abort code: 3, in '0x...::operator_policy::assert_can_spend' (instruction 29)"
  // SDK format B (debug serialization):
  //   "MoveAbort(MoveLocation { module: ModuleId { ... name: Identifier(\"operator_policy\") }, function: 12, function_name: Some(\"record_spend\") }, 3) in command 0"

  const formatACode = raw.match(/abort code:\s*(\d+)/i);
  const formatAQual = raw.match(/in\s*'[^']*::([a-zA-Z0-9_]+)::([a-zA-Z0-9_]+)'/);
  const formatBCode = raw.match(/\}\s*,\s*(\d+)\s*\)\s*in command/);
  const formatBFn = raw.match(/function_name:\s*Some\("([^"]+)"\)/);
  const formatBModule = raw.match(/Identifier\("([a-zA-Z0-9_]+)"\)/);

  const code = Number(
    (formatACode?.[1] ?? formatBCode?.[1] ?? "NaN"),
  );

  let moduleName: string | undefined;
  let fnName: string | undefined;
  if (formatAQual) {
    moduleName = formatAQual[1];
    fnName = formatAQual[2];
  } else if (formatBFn || formatBModule) {
    fnName = formatBFn?.[1];
    moduleName = formatBModule?.[1];
    if (!moduleName && fnName === "record_spend") moduleName = "operator_policy";
  }

  const named =
    moduleName && Number.isFinite(code) ? ABORT_CODES[moduleName]?.[code] : undefined;

  console.error("[approve] tx ABORTED on chain — policy enforced");
  if (digest) {
    console.error(`[approve] digest    ${digest}`);
    console.error(`[approve] explorer  https://suiscan.xyz/${network}/tx/${digest}`);
  }
  if (moduleName) console.error(`[approve] module    ${moduleName}`);
  if (fnName) console.error(`[approve] function  ${fnName}`);
  if (Number.isFinite(code)) {
    console.error(
      `[approve] code      ${code}${named ? ` (${named})` : ""}`,
    );
  }
  if (!named) {
    // surface raw for debugging when we can't pretty-print
    console.error(`[approve] raw       ${raw.slice(0, 280)}`);
  }
}

main().catch((e) => {
  reportAbort("testnet", e);
  process.exit(1);
});
