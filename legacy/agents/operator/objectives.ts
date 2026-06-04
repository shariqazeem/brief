// Operator mission objective resolver.
//
// The Move OperatorPolicy doesn't carry an `objective: String` field (the
// v2 package upgrade was `compatible` — we can't extend the struct). So the
// operator's mandate lives off-chain: the frontend writes it into a small
// file at .brief/objectives.json keyed by policy id when the user grants;
// the agent reads from the same file, falling back to a template-derived
// default based on the policy name.
//
// This is documented honestly in the product copy as "the mandate the
// operator is serving" — it's not on-chain, but it's auditable in the
// payload of every action the operator mints.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OBJECTIVES_FILE = join(process.cwd(), ".brief", "objectives.json");

/**
 * Read the configured objective for this policy. Lookup order:
 *   1. BRIEF_OBJECTIVES_JSON env (map: { [policyId]: objective }) — for VM deploy
 *   2. .brief/objectives.json local file
 *   3. Derived default from the policy name
 */
export function resolveObjective(
  policyId: string,
  policyName: string,
): string {
  // 1. Env-driven map (deploy-friendly; one env var holds all)
  const envBlob = process.env.BRIEF_OBJECTIVES_JSON;
  if (envBlob) {
    try {
      const m = JSON.parse(envBlob) as Record<string, string>;
      if (typeof m[policyId] === "string") return m[policyId]!;
    } catch {
      // ignore — fall through
    }
  }

  // 2. Local file
  if (existsSync(OBJECTIVES_FILE)) {
    try {
      const raw = readFileSync(OBJECTIVES_FILE, "utf8");
      const m = JSON.parse(raw) as Record<string, string>;
      if (typeof m[policyId] === "string") return m[policyId]!;
    } catch {
      // ignore
    }
  }

  // 3. Default derived from the policy name
  return deriveDefaultObjective(policyName);
}

function deriveDefaultObjective(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("conservative") || lower.includes("low-risk")) {
    return "Preserve capital while maintaining low-risk yield exposure";
  }
  if (lower.includes("stable") || lower.includes("treasury")) {
    return "Park stable-value capital and generate yield without concentration risk";
  }
  if (lower.includes("market maker") || lower.includes("market-maker")) {
    return "Provide liquidity on DeepBook and rotate capital efficiently";
  }
  if (lower.includes("growth")) {
    return "Capture moderate-yield opportunities without breaching risk envelope";
  }
  return "Operate within the envelope and report every decision on-chain";
}
