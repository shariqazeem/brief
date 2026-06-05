// Workforce planner-service.
//
// Two cooperating loops, one source of truth (.brief/missions.json):
//
// 1. MISSION LOOP — polls .brief/missions.json. For each "pending"
//    mission, marks it "running", exec's the planner CLI to decompose +
//    post sub-tasks, and marks "complete" or "failed" based on exit
//    code. The set of policy ids referenced by missions becomes the
//    "managed policies" set for loop 2.
//
// 2. AUTO-APPROVE LOOP — every AUTO_APPROVE_TICK_MS, scans the managed
//    policies for tasks in DELIVERED status. When a delivered task has
//    been visible for AUTO_APPROVE_DELAY_MS (long enough for a judge to
//    notice the row light up green), it spawns the approve-task CLI to
//    settle on chain. If the policy has been revoked, the chain aborts
//    the approve with EPolicyRevoked — the abort IS the kill-switch
//    payoff (the /workforce UI also surfaces it directly when the user
//    presses Revoke). Tasks are only auto-approved once per process
//    lifetime; the chain's status check prevents double-settling.
//
// Run:
//   npm run workforce:planner-service

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { fetchTask } from "../agents/workforce/lib/task.js";

type MissionStatus = "pending" | "running" | "complete" | "failed";

type Mission = {
  policy_id: string;
  mission: string;
  target_package_id?: string;
  bounty_sui?: number;
  max_subtasks?: number;
  queued_at_ms: number;
  status: MissionStatus;
  started_at_ms?: number;
  finished_at_ms?: number;
  error?: string;
};

const POLL_MS = 5000;
const AUTO_APPROVE_TICK_MS = 3500;
/** Hold a delivered task at "delivered" for this long before auto-settling so
 *  a watcher visibly sees the row light green then transition to paid — and,
 *  more importantly, has time to press Revoke and watch the chain refuse the
 *  settlement. */
const AUTO_APPROVE_DELAY_MS = 12_000;
const REPO_ROOT = process.cwd();
const QUEUE_PATH = join(REPO_ROOT, ".brief", "missions.json");
const PLANNER_ENTRY = join(REPO_ROOT, "agents", "workforce", "planner", "index.ts");
const APPROVE_ENTRY = join(REPO_ROOT, "scripts", "workforce-approve-task.ts");
const ENV_FILE = join(REPO_ROOT, ".env.local");

function ensureFile(): void {
  try {
    mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  } catch {
    /* ignore */
  }
  if (!existsSync(QUEUE_PATH)) {
    writeFileSync(QUEUE_PATH, "[]", "utf8");
  }
}

function loadQueue(): Mission[] {
  ensureFile();
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf8")) as Mission[];
  } catch {
    return [];
  }
}

function saveQueue(q: Mission[]): void {
  ensureFile();
  writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2), "utf8");
}

function updateMission(
  index: number,
  patch: Partial<Mission>,
): void {
  const q = loadQueue();
  if (index >= q.length) return;
  q[index] = { ...q[index], ...patch };
  saveQueue(q);
}

function plannerArgs(m: Mission): string[] {
  const args = [
    "--env-file=" + ENV_FILE,
    resolve(PLANNER_ENTRY),
    "--policy",
    m.policy_id,
    "--mission",
    m.mission,
  ];
  if (m.target_package_id) {
    args.push("--target-package-id", m.target_package_id);
  }
  if (m.bounty_sui) {
    args.push("--default-bounty-sui", String(m.bounty_sui));
  }
  if (m.max_subtasks) {
    args.push("--max-subtasks", String(m.max_subtasks));
  }
  return args;
}

async function runPlanner(m: Mission, idx: number): Promise<boolean> {
  return new Promise<boolean>((resolveProm) => {
    const args = plannerArgs(m);
    console.log(
      `[planner-service] mission #${idx} policy=${m.policy_id.slice(0, 10)}… mission="${m.mission.slice(0, 60).replace(/\n/g, " ")}${m.mission.length > 60 ? "…" : ""}"`,
    );
    const child = spawn("tsx", args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const errChunks: string[] = [];
    child.stdout.on("data", (b: Buffer) => {
      process.stdout.write(b.toString().replace(/^/gm, `  [planner #${idx}] `));
    });
    child.stderr.on("data", (b: Buffer) => {
      const s = b.toString();
      errChunks.push(s);
      process.stderr.write(s.replace(/^/gm, `  [planner #${idx} err] `));
    });
    child.on("close", (code) => {
      if (code === 0) {
        updateMission(idx, {
          status: "complete",
          finished_at_ms: Date.now(),
        });
        console.log(`[planner-service] mission #${idx} complete`);
        resolveProm(true);
      } else {
        const errSummary = errChunks.join("").trim().slice(-400);
        updateMission(idx, {
          status: "failed",
          finished_at_ms: Date.now(),
          error: errSummary || `exit code ${code}`,
        });
        console.log(`[planner-service] mission #${idx} FAILED exit=${code}`);
        resolveProm(false);
      }
    });
    child.on("error", (e) => {
      updateMission(idx, {
        status: "failed",
        finished_at_ms: Date.now(),
        error: e.message,
      });
      console.log(`[planner-service] mission #${idx} ERROR ${e.message}`);
      resolveProm(false);
    });
  });
}

async function tick(): Promise<void> {
  const q = loadQueue();
  for (let i = 0; i < q.length; i++) {
    if (q[i].status === "pending") {
      updateMission(i, { status: "running", started_at_ms: Date.now() });
      // Mission decomposition + posting is the Planner-signed CLI; hold
      // the lock for the full run so the auto-approve loop can't fire
      // concurrently with it.
      await withPlannerLock(`mission#${i}`, () => runPlanner(q[i], i));
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-approve loop. Settles delivered tasks under any policy referenced by
// a mission in the queue. Tracks per-task first-seen + first-attempt state
// so we don't double-trigger (the chain rejects redundant approves anyway,
// but we want clean logs).
// ---------------------------------------------------------------------------

type AutoState = {
  firstSeenMs: number;
  attempted: boolean;
};

const autoState = new Map<string, AutoState>();
const env = loadEnv();
const ctx = makeAgentContext(env);

// Cross-loop mutex on planner-signed spawns. The two loops in this
// process (mission decomposition and auto-approve settlement) both sign
// as the Planner wallet, and approve-task spawns from the frontend's
// /api/workforce/approve route are a third (cross-process) signer. To
// prevent the same gas coin from being reserved by two child processes
// concurrently inside THIS process, we serialize every planner-signed
// CLI spawn here. The frontend approve calls hit a separate process —
// for those, the per-tx retry helper handles the cross-process race.
let plannerSpawnLock: Promise<void> = Promise.resolve();
async function withPlannerLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const prior = plannerSpawnLock;
  let release!: () => void;
  plannerSpawnLock = new Promise<void>((r) => {
    release = r;
  });
  await prior;
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - started;
    console.log(`[planner-lock] released after ${ms}ms (${label})`);
    release();
  }
}

function managedPolicyIds(): Set<string> {
  const out = new Set<string>();
  for (const m of loadQueue()) {
    if (m.policy_id && m.policy_id.startsWith("0x")) {
      out.add(m.policy_id);
    }
  }
  return out;
}

async function approveTask(taskId: string, policyId: string): Promise<void> {
  return new Promise<void>((resolveProm) => {
    const args = [
      "--env-file=" + ENV_FILE,
      resolve(APPROVE_ENTRY),
      "--task",
      taskId,
      "--policy",
      policyId,
    ];
    const child = spawn("tsx", args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let captured = "";
    child.stdout.on("data", (b: Buffer) => {
      captured += b.toString();
      process.stdout.write(
        b.toString().replace(/^/gm, `  [auto-approve] `),
      );
    });
    child.stderr.on("data", (b: Buffer) => {
      captured += b.toString();
      process.stderr.write(
        b.toString().replace(/^/gm, `  [auto-approve err] `),
      );
    });
    child.on("close", () => {
      // captured is logged in real-time above; we don't differentiate
      // success vs abort here — the chain is the source of truth and
      // the next pass will reflect the new task status.
      void captured;
      resolveProm();
    });
    child.on("error", () => resolveProm());
  });
}

let autoApproveTicking = false;
async function autoApproveTick(): Promise<void> {
  // Reentrancy guard: a tick can take seconds (the approve spawn is
  // synchronous from this loop's POV). If the previous tick is still
  // running when the interval fires again, skip — the next tick will
  // catch up.
  if (autoApproveTicking) return;
  autoApproveTicking = true;
  try {
    return await autoApproveTickImpl();
  } finally {
    autoApproveTicking = false;
  }
}

async function autoApproveTickImpl(): Promise<void> {
  const policyIds = managedPolicyIds();
  if (policyIds.size === 0) return;

  // Pull recent TaskPosted events across all policies and filter to ours.
  let events;
  try {
    events = await ctx.client.queryEvents({
      query: { MoveEventType: `${ctx.typeOriginId}::task::TaskPosted` },
      order: "descending",
      limit: 200,
    });
  } catch {
    return;
  }
  type Candidate = { taskId: string; policyId: string; postedAtMs: bigint };
  const byPolicy = new Map<string, Candidate[]>();
  for (const ev of events.data) {
    const p = ev.parsedJson as {
      task_id?: string;
      parent_policy?: string | null | { vec?: string[] };
      posted_at_ms?: string;
    };
    if (!p?.task_id) continue;
    const parent = unwrapOption(p.parent_policy);
    if (!parent || !policyIds.has(parent)) continue;
    const arr = byPolicy.get(parent) ?? [];
    arr.push({
      taskId: p.task_id,
      policyId: parent,
      postedAtMs: BigInt(p.posted_at_ms ?? "0"),
    });
    byPolicy.set(parent, arr);
  }
  if (byPolicy.size === 0) return;

  // Per policy: fetch each candidate's current status, find DELIVERED ones,
  // and HOLD the most-recently-posted as "pending release" so the
  // /workforce UI always has a live target for its kill-switch demo. The
  // rest auto-settle on the watchable hold (the visible "alive" beat).
  for (const [policyId, items] of byPolicy) {
    type Live = {
      id: string;
      postedAtMs: bigint;
      status: string;
    };
    const live: Live[] = [];
    for (const it of items) {
      try {
        const t = await fetchTask(ctx, it.taskId);
        live.push({ id: it.taskId, postedAtMs: it.postedAtMs, status: t.status });
      } catch {
        /* skip */
      }
    }
    const delivered = live
      .filter((t) => t.status === "delivered")
      .sort((a, b) => Number(b.postedAtMs - a.postedAtMs));
    if (delivered.length === 0) continue;

    // The newest delivered task is held back as the pending-release
    // checkpoint — the policy's auto_approve_pct field formalizes this as
    // a human-in-the-loop checkpoint on autonomous spend. Older delivered
    // tasks settle once they age past the watchable hold.
    const [held, ...settleable] = delivered;
    autoState.set(held.id, {
      firstSeenMs: autoState.get(held.id)?.firstSeenMs ?? Date.now(),
      attempted: false,
    });

    const now = Date.now();
    for (const t of settleable) {
      const tracked = autoState.get(t.id);
      if (tracked?.attempted) continue;
      if (!tracked) {
        autoState.set(t.id, { firstSeenMs: now, attempted: false });
        console.log(
          `[auto-approve] saw delivered task=${t.id.slice(0, 10)}… policy=${policyId.slice(0, 10)}… — holding ${AUTO_APPROVE_DELAY_MS}ms before settling`,
        );
        continue;
      }
      if (now - tracked.firstSeenMs < AUTO_APPROVE_DELAY_MS) continue;
      autoState.set(t.id, { ...tracked, attempted: true });
      console.log(
        `[auto-approve] settling task=${t.id.slice(0, 10)}… policy=${policyId.slice(0, 10)}… (newer delivered task is the pending release)`,
      );
      // Serialize against the mission loop and against any in-flight
      // auto-approve. The lock guarantees no two Planner-signed CLIs run
      // concurrently within this process.
      await withPlannerLock(`auto-approve:${t.id.slice(0, 10)}`, () =>
        approveTask(t.id, policyId),
      );
    }
  }
}

function unwrapOption(
  v: string | null | undefined | { vec?: string[] },
): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v?.vec) && v.vec.length > 0) return v.vec[0];
  return null;
}

async function main(): Promise<void> {
  console.log(
    `[planner-service] watching ${QUEUE_PATH} every ${POLL_MS / 1000}s · planner=${PLANNER_ENTRY.replace(REPO_ROOT, ".")}`,
  );
  console.log(
    `[planner-service] auto-approve loop every ${AUTO_APPROVE_TICK_MS / 1000}s · hold delivered ${AUTO_APPROVE_DELAY_MS / 1000}s`,
  );
  // Process anything that was already queued at boot.
  await tick();
  setInterval(() => {
    tick().catch((e) => {
      console.error("[planner-service] tick error:", e);
    });
  }, POLL_MS);
  setInterval(() => {
    autoApproveTick().catch((e) => {
      console.error("[planner-service] auto-approve tick error:", e);
    });
  }, AUTO_APPROVE_TICK_MS);
}

main().catch((e) => {
  console.error("[planner-service] fatal:", e);
  process.exit(1);
});
