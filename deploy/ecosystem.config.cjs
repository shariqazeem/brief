// PM2 ecosystem for Brief — four long-running processes that share one
// repo checkout + one .env.local on the VM. Launched by deploy.sh.

const path = require("node:path");
const REPO_ROOT = path.resolve(__dirname, "..");

const baseEnv = {
  NODE_ENV: "production",
  // The always-on agents stay on the deterministic template path so we
  // don't burn LLM credits 24/7. Switch to "llm" only when recording.
  BRIEF_LLM_MODE: "mock",
};

const tsxArgs = (entry) =>
  ["--env-file=.env.local", entry].map((a) => a).join(" ");

module.exports = {
  apps: [
    {
      name: "brief-web",
      cwd: REPO_ROOT,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      max_memory_restart: "600M",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      env: baseEnv,
    },
    {
      name: "brief-research",
      cwd: REPO_ROOT,
      script: "node_modules/.bin/tsx",
      args: tsxArgs("agents/workforce/research/index.ts"),
      max_memory_restart: "400M",
      autorestart: true,
      max_restarts: 30,
      restart_delay: 5000,
      env: baseEnv,
    },
    {
      name: "brief-treasury",
      cwd: REPO_ROOT,
      script: "node_modules/.bin/tsx",
      args: tsxArgs("agents/workforce/treasury/index.ts"),
      max_memory_restart: "400M",
      autorestart: true,
      max_restarts: 30,
      restart_delay: 5000,
      env: baseEnv,
    },
    {
      name: "brief-planner-service",
      cwd: REPO_ROOT,
      script: "node_modules/.bin/tsx",
      args: tsxArgs("scripts/workforce-planner-service.ts"),
      max_memory_restart: "400M",
      autorestart: true,
      max_restarts: 30,
      restart_delay: 5000,
      env: baseEnv,
    },
  ],
};
