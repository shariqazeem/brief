// POST /api/workforce/post-verification — post a tiny task under a
// revoked policy so the /workforce kill-switch demo always has a
// DELIVERED task to abort on, even after the judge has watched every
// previously-delivered task settle to paid.
//
// The task carries a token bounty (0.005 SUI), is assigned to a
// specialist the caller picks (the UI knows the live roster), and lists
// the policy as its parent. After the specialist delivers, the front-end
// calls /api/workforce/approve, which aborts with EPolicyRevoked because
// the policy is revoked.
//
// Body: { policy_id, assigned_to, capability, title? }
// Returns: { ok, task_id, tx_digest } | { ok: false, error }

import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  getClientIp,
  rateLimit,
  rateLimitedResponse,
} from "@/lib/rate-limit";

const REPO_ROOT = process.cwd();
const ENV_FILE = join(REPO_ROOT, ".env.local");
const SCRIPT = join(REPO_ROOT, "scripts", "workforce-post-task.ts");

const DEFAULT_BOUNTY_SUI = "0.005";
const DEFAULT_DEADLINE_MIN = "60";
const DEFAULT_TITLE = "Kill-switch verification";
const DEFAULT_SPEC = JSON.stringify({
  context:
    "Kill-switch verification: the user revoked the policy after every prior delivery had been paid. Acknowledge by delivering a minimal report so the chain can refuse settlement and prove the policy is enforced.",
  action: "kill_switch_verify",
});

type PostBody = {
  policy_id?: string;
  policyId?: string;
  assigned_to?: string;
  assignedTo?: string;
  capability?: string;
  title?: string;
};

type PostResult = {
  ok: boolean;
  taskId?: string;
  txDigest?: string;
  error?: string;
  stderr?: string;
};

async function runPost(args: {
  policyId: string;
  assignedTo: string;
  capability: string;
  title: string;
}): Promise<PostResult> {
  return new Promise<PostResult>((resolve) => {
    const cliArgs = [
      "--env-file=" + ENV_FILE,
      SCRIPT,
      "--to",
      args.assignedTo,
      "--capability",
      args.capability,
      "--bounty-sui",
      DEFAULT_BOUNTY_SUI,
      "--title",
      args.title,
      "--spec",
      DEFAULT_SPEC,
      "--parent-policy",
      args.policyId,
      "--deadline-min",
      DEFAULT_DEADLINE_MIN,
    ];
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
      // The post CLI emits "[post-task] ok · task=0x…" followed by
      // "[post-task] tx=…" on success. Parse both.
      const taskMatch = stdout.match(/\[post-task\] ok · task=(0x[0-9a-f]+)/i);
      const txMatch = stdout.match(/\[post-task\] tx=([A-Za-z0-9]+)/);
      const ok =
        code === 0 && !!taskMatch?.[1] && !!txMatch?.[1];
      resolve({
        ok,
        taskId: taskMatch?.[1],
        txDigest: txMatch?.[1],
        error: ok ? undefined : `exit=${code}`,
        stderr: stderr.slice(-800),
      });
    });
    child.on("error", (e) => {
      resolve({
        ok: false,
        error: e.message,
        stderr: stderr,
      });
    });
  });
}

export async function POST(req: Request): Promise<Response> {
  // 3/min per IP — verification posts spend planner SUI, throttle hard.
  const rl = rateLimit("post-verification", getClientIp(req), {
    windowMs: 60_000,
    max: 3,
  });
  if (!rl.ok) {
    return rateLimitedResponse(rl.retryAfterSec);
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const policyId = body.policy_id ?? body.policyId;
  const assignedTo = body.assigned_to ?? body.assignedTo;
  const capability = body.capability;
  const title = body.title ?? DEFAULT_TITLE;

  if (!policyId || !policyId.startsWith("0x")) {
    return Response.json({ error: "policy_id must be 0x…" }, { status: 400 });
  }
  if (!assignedTo || !assignedTo.startsWith("0x")) {
    return Response.json({ error: "assigned_to must be 0x…" }, { status: 400 });
  }
  if (!capability || !/^[a-z_]+$/.test(capability)) {
    return Response.json(
      { error: "capability is required (lowercase identifier)" },
      { status: 400 },
    );
  }

  const result = await runPost({
    policyId,
    assignedTo,
    capability,
    title,
  });

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: result.error ?? "post failed",
        stderr: result.stderr,
      },
      { status: 200 },
    );
  }
  return Response.json({
    ok: true,
    task_id: result.taskId,
    tx_digest: result.txDigest,
  });
}
