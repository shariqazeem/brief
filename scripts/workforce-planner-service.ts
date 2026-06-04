// Workforce planner-service.
//
// Polls the mission queue at .brief/missions.json every POLL_MS. For each
// "pending" mission, marks it "running", exec's the existing planner CLI
// with the right args, and marks "complete" or "failed" based on exit
// code. Stdout from the planner is streamed live to this process's
// stdout (prefixed) so the operator can tail one log.
//
// Run:
//   npm run workforce:planner-service
//
// The /workforce UI POSTs to /api/workforce/missions which appends to the
// queue. This service is the consumer that actually invokes the planner.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

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
const REPO_ROOT = process.cwd();
const QUEUE_PATH = join(REPO_ROOT, ".brief", "missions.json");
const PLANNER_ENTRY = join(REPO_ROOT, "agents", "workforce", "planner", "index.ts");
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
      // Process one mission at a time so we don't race the same wallet.
      await runPlanner(q[i], i);
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `[planner-service] watching ${QUEUE_PATH} every ${POLL_MS / 1000}s · planner=${PLANNER_ENTRY.replace(REPO_ROOT, ".")}`,
  );
  // Process anything that was already queued at boot.
  await tick();
  setInterval(() => {
    tick().catch((e) => {
      console.error("[planner-service] tick error:", e);
    });
  }, POLL_MS);
}

main().catch((e) => {
  console.error("[planner-service] fatal:", e);
  process.exit(1);
});
