// POST /api/workforce/approve — approve a delivered task on behalf of the
// poster (the Planner agent). Single-wallet Wk1: the planner's AGENT_SECRET_KEY
// from .env.local signs the approve_with_policy tx. The connected dApp Kit
// wallet (the OWNER) doesn't sign — they delegated authority at grant time.
//
// Body: { task_id, policy_id? }
// Returns: { ok, txDigest?, abortCode?, abortConst?, error? }
//
// Implementation: spawn the existing `workforce:approve-task` CLI. Parses
// the stdout for the success tx digest or the abort code report.

import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  getClientIp,
  rateLimit,
  rateLimitedResponse,
} from "@/lib/rate-limit";

const REPO_ROOT = process.cwd();
const ENV_FILE = join(REPO_ROOT, ".env.local");
const SCRIPT = join(REPO_ROOT, "scripts", "workforce-approve-task.ts");

type ApproveBody = {
  task_id?: string;
  taskId?: string;
  policy_id?: string;
  policyId?: string;
};

type ApproveResult = {
  ok: boolean;
  txDigest?: string;
  abortCode?: number;
  abortConst?: string;
  abortModule?: string;
  abortFn?: string;
  stdout: string;
  stderr: string;
};

async function runApprove(args: {
  taskId: string;
  policyId?: string;
}): Promise<ApproveResult> {
  return new Promise<ApproveResult>((resolveProm) => {
    const cliArgs = [
      "--env-file=" + ENV_FILE,
      SCRIPT,
      "--task",
      args.taskId,
      // Trader-product tasks are Treasury-posted (== policy.agent), so the
      // approve must be Treasury-signed to clear sender==poster AND
      // record_spend's sender==agent — and to abort EPolicyRevoked (not
      // ENotAgent) after a revoke.
      "--as",
      "treasury",
    ];
    if (args.policyId) {
      cliArgs.push("--policy", args.policyId);
    }
    const child = spawn("tsx", cliArgs, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("close", (code) => {
      const combined = stdout + "\n" + stderr;
      const okMatch = stdout.match(/\[approve\] ok · tx=([A-Za-z0-9]+)/);
      const codeMatch = combined.match(/code\s+(\d+)(?:\s*\(([A-Za-z]+)\))?/);
      const moduleMatch = combined.match(/module\s+([a-z_]+)/);
      const fnMatch = combined.match(/function\s+([a-z_]+)/);
      resolveProm({
        ok: code === 0 && !!okMatch,
        txDigest: okMatch?.[1],
        abortCode: codeMatch ? Number(codeMatch[1]) : undefined,
        abortConst: codeMatch?.[2],
        abortModule: moduleMatch?.[1],
        abortFn: fnMatch?.[1],
        stdout,
        stderr,
      });
    });
    child.on("error", (e) => {
      resolveProm({
        ok: false,
        stdout,
        stderr: stderr + "\n" + e.message,
      });
    });
  });
}

export async function POST(req: Request): Promise<Response> {
  // 10/min per IP — approve is gas-only (cheap) but each attempt is a
  // real on-chain tx; throttling keeps a runaway client from spamming
  // gas-burns.
  const rl = rateLimit("approve", getClientIp(req), {
    windowMs: 60_000,
    max: 10,
  });
  if (!rl.ok) {
    return rateLimitedResponse(rl.retryAfterSec);
  }

  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const taskId = body.task_id ?? body.taskId;
  const policyId = body.policy_id ?? body.policyId;
  if (!taskId || !taskId.startsWith("0x")) {
    return Response.json({ error: "task_id must be 0x…" }, { status: 400 });
  }
  if (policyId && !policyId.startsWith("0x")) {
    return Response.json({ error: "policy_id must be 0x…" }, { status: 400 });
  }
  const result = await runApprove({ taskId, policyId });
  if (result.ok) {
    return Response.json({
      ok: true,
      txDigest: result.txDigest,
    });
  }
  return Response.json(
    {
      ok: false,
      abortCode: result.abortCode,
      abortConst: result.abortConst,
      abortModule: result.abortModule,
      abortFn: result.abortFn,
      stderr: result.stderr.slice(-1200),
    },
    { status: 200 },
  );
}
