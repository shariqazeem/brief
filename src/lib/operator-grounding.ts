// Ask Mira · grounding loader (server-only).
//
// Before the LLM ever speaks, we assemble the operator's VERIFIABLE state from
// the same `.cursors/*.json` files the trader writes: identity, current stance,
// recent decisions, settled trades, lifetime stats, the Risk Guardian, and the
// latest daily reflection. The chat endpoint injects this as structured context
// and the model may use ONLY these facts. Every citeable id (tx digest / Walrus
// blob) is collected into `validRefs` so a hallucinated reference can be dropped
// before it reaches the user. This is what makes Ask Mira grounded, not vibes.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { operatorIdentity, operatorTemplate } from "./operators";

const CURSORS = path.join(process.cwd(), ".cursors");
const slugOf = (policyId: string) => policyId.slice(2, 14);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

type Rec = Record<string, unknown>;
const asRec = (x: unknown): Rec => (x && typeof x === "object" ? (x as Rec) : {});
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const num = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
/** Round for the model-facing context so answers never parrot a raw float like
 *  "$9.998728999999999". */
const rnd = (x: unknown, d = 2): number | null => {
  const n = num(x);
  return n == null ? null : Number(n.toFixed(d));
};

export type RegistryEntry = {
  policyId: string;
  owner?: string;
  mode?: string;
  universe?: string[] | null;
  template?: string | null;
  name?: string | null;
  role?: string | null;
  mandate?: { targetReturnPct?: number; horizonDays?: number; maxDrawdownPct?: number } | null;
  network?: "mainnet" | "testnet";
  adoptedAtMs?: number;
  revoked?: boolean;
};

export type Grounding = {
  found: boolean;
  policyId: string;
  identity: { name: string; role: string; template: string | null };
  personalityBlock: string;
  /** Compact, model-facing context object (only verifiable facts). */
  context: Rec;
  /** Every tx digest / Walrus blob id the model is allowed to cite. */
  validRefs: { txDigests: Set<string>; blobIds: Set<string> };
  /** Hard limits restated for the "what can't you do" answer. */
  neverDoes: string[];
};

/** Compose a short, truthful personality/voice block for the system prompt from
 *  the operator's template copy (no invented persona). */
function personalityBlock(template: string | null, role: string): string {
  const t = operatorTemplate(template ?? undefined);
  if (!t) {
    return `You are a disciplined capital operator (${role}). You are calm, precise, and factual, and you are proud of your discipline, not your returns.`;
  }
  const firstSentence = t.explanation.split(". ")[0] ?? t.promise;
  return `You are ${t.name}, ${t.role}. ${t.promise} ${firstSentence}. You speak plainly and factually, in the first person, and you are proud of your discipline, not your returns.`;
}

export async function loadGrounding(policyId: string): Promise<Grounding> {
  const slug = slugOf(policyId);
  const [registryList, exp, ledger, statsRaw, guardianRaw, reflections] = await Promise.all([
    readJson<RegistryEntry[]>(path.join(CURSORS, "operator-registry.json"), []),
    readJson<Rec[]>(path.join(CURSORS, `operator-experience-${slug}.json`), []),
    readJson<Rec[]>(path.join(CURSORS, `operator-ledger-${slug}.json`), []),
    readJson<Rec>(path.join(CURSORS, `operator-stats-${slug}.json`), {}),
    readJson<Rec>(path.join(CURSORS, "guardian-status.json"), {}),
    readJson<Rec[]>(path.join(CURSORS, `daily-reflections-${slug}.json`), []),
  ]);

  const entry = Array.isArray(registryList)
    ? registryList.find((e) => e?.policyId === policyId)
    : undefined;

  const identity = operatorIdentity({
    templateSlug: entry?.template ?? null,
    name: entry?.name ?? null,
    role: entry?.role ?? null,
    mode: entry?.mode ?? null,
  });
  const template = operatorTemplate(entry?.template ?? undefined);

  const validRefs = { txDigests: new Set<string>(), blobIds: new Set<string>() };

  // ---- current stance + recent decisions (newest last in the archive) -------
  const decisions = Array.isArray(exp) ? exp : [];
  const latest = decisions.length ? asRec(decisions[decisions.length - 1]) : {};
  const latestDetail = asRec(latest.detail);
  const latestPlan = asRec(latestDetail.plan);

  const recentDecisions = decisions
    .slice(-6)
    .reverse()
    .map((d) => {
      const r = asRec(d);
      const det = asRec(r.detail);
      const tx = str(det.txDigest);
      const blob = str(det.aiBlobId);
      if (tx) validRefs.txDigests.add(tx);
      if (blob) validRefs.blobIds.add(blob);
      return {
        seq: num(r.seq),
        asset: str(r.asset),
        decided: r.decided === true,
        direction: str(r.direction),
        outcome: str(r.outcome),
        outcomePct: rnd(r.outcomePct, 4),
        regime: str(det.regimeLabel) ?? str(r.regimeKind),
        thesis: str(det.thesis),
        verdict: str(det.verdict),
        ai_source: str(det.aiSource),
        tx_digest: tx,
        walrus_blob_id: blob,
      };
    });

  // ---- settled trades from the permanent ledger ------------------------------
  const ledgerRows = (Array.isArray(ledger) ? ledger : [])
    .slice(-8)
    .reverse()
    .map((row) => {
      const r = asRec(row);
      const tx = str(r.txDigest);
      if (tx) validRefs.txDigests.add(tx);
      return {
        side: str(r.side),
        asset: str(r.asset),
        from_pct: rnd(r.fromExposurePct, 1),
        target_pct: rnd(r.targetPct, 1),
        outcome: str(r.outcome),
        outcome_pct: rnd(r.outcomePct, 4),
        fee_inclusive: r.costPct != null,
        tx_digest: tx,
      };
    });

  // ---- lifetime stats --------------------------------------------------------
  const stats = asRec(statsRaw);
  const statsView = {
    mode: str(stats.mode) ?? entry?.mode ?? null,
    decisions: num(stats.decisions),
    buys: num(stats.buys),
    sells: num(stats.sells),
    abstentions: num(stats.abstentions),
    deposit_usd: rnd(stats.deposit, 2),
    last_value_usd: rnd(stats.lastValue, 4),
    worst_drawdown_pct: rnd(stats.worstDrawdownPct, 1),
    withdrawn: stats.withdrawn === true,
    launch_ts: num(stats.launchTs),
  };

  // ---- Risk Guardian (per-asset) --------------------------------------------
  const guardianOps = asRec(asRec(guardianRaw).operators);
  const g = asRec(guardianOps[policyId]);
  const guardianView = Object.keys(g).length
    ? {
        risk_level: str(g.riskLevel) ?? (g.paused === true ? "crash" : "normal"),
        reason: str(g.reason),
        assets: asRec(g.assets),
        drawdown_pause: asRec(g.portfolio).drawdownPause === true,
      }
    : null;

  // ---- latest daily reflection ----------------------------------------------
  const refl = Array.isArray(reflections) && reflections.length
    ? asRec(reflections[reflections.length - 1])
    : {};
  const reflBlob = str(refl.blobId);
  if (reflBlob) validRefs.blobIds.add(reflBlob);
  const reflectionView = Object.keys(refl).length
    ? {
        date: str(refl.date),
        worked: str(refl.worked),
        failed: str(refl.failed),
        lesson: str(refl.lesson),
        walrus_blob_id: reflBlob,
      }
    : null;

  // ---- policy state (from the freshest decision's portfolio snapshot) --------
  const latestPortfolio = asRec(latest.portfolio ?? asRec(latestDetail).portfolio);

  const context: Rec = {
    identity: {
      name: identity.name,
      role: identity.role,
      mode: entry?.mode ?? statsView.mode,
      universe: entry?.universe ?? (template ? template.universe : null),
      network: entry?.network ?? "mainnet",
    },
    current_stance: {
      // the deployed trader adds `stance` to the decision event; fall back to
      // the allocation line for archives written before that shipped.
      line: str(asRec(latest.stance).line) ?? str(latest.allocation) ?? str(latestDetail.verdict),
      target_exposure_pct: num(latest.targetExposurePct),
      regime: str(latestDetail.regimeLabel),
      plan: Object.keys(latestPlan).length
        ? {
            now: str(latestPlan.now),
            why: str(latestPlan.why),
            watching: str(latestPlan.watching),
            will_act_when: str(latestPlan.willActWhen),
            will_stop_if: str(latestPlan.willStopIf),
          }
        : null,
      last_verdict: str(latestDetail.verdict),
    },
    policy_state: {
      deposit_usd: statsView.deposit_usd,
      current_value_usd: rnd(latestPortfolio.value, 4) ?? statsView.last_value_usd,
      pnl_pct: rnd(latestPortfolio.pnl_pct, 2),
      budget_remaining_pct: rnd(latestPortfolio.budget_remaining_pct, 1),
      mandate: entry?.mandate ?? null,
    },
    recent_decisions: recentDecisions,
    settled_trades: ledgerRows,
    lifetime_stats: statsView,
    guardian: guardianView,
    latest_reflection: reflectionView,
  };

  const neverDoes = template?.neverDoes ?? [
    "Withdraw your funds — no WithdrawCap exists, so no one, not even the operator, can move your money out.",
    "Exceed its budget — the Move policy caps cumulative spend and aborts any trade that would go over.",
    "Trade outside its allowed venues — the policy's allow-list rejects it on-chain.",
    "Keep trading after you revoke — one signature freezes it permanently.",
  ];

  return {
    found: !!entry,
    policyId,
    identity: { name: identity.name, role: identity.role, template: entry?.template ?? null },
    personalityBlock: personalityBlock(entry?.template ?? null, identity.role),
    context,
    validRefs,
    neverDoes,
  };
}

/** A grounded, deterministic answer used when there is no LLM key or the model
 *  call fails · it never invents, it restates the real grounding. Keeps Ask
 *  Mira useful (and the demo alive) with zero spend. */
export function deterministicAnswer(message: string, g: Grounding): { answer: string; refs: Ref[] } {
  const c = g.context;
  const stance = asRec(c.current_stance);
  const stats = asRec(c.lifetime_stats);
  const refl = asRec(c.latest_reflection);
  const name = g.identity.name;
  const q = message.toLowerCase();
  const refs: Ref[] = [];

  const wantsLimits = /(can'?t|cannot|never|leash|withdraw|rug|steal|safe|constraint|limit)/.test(q);
  const wantsLesson = /(learn|lesson|week|reflect|improve|mistake)/.test(q);
  const wantsTrade = /(sell|sold|buy|bought|trade|traded|yesterday|position|move)/.test(q);

  if (wantsLimits) {
    return {
      answer:
        `I'm ${name}. Here's what I can never do, and it's enforced by the Move policy on Sui, not by trusting me: ` +
        g.neverDoes.map((s) => s.replace(/\s+·.*$/, "")).join(" ") +
        ` That's the point — the chain holds the leash.`,
      refs,
    };
  }
  if (wantsLesson && str(refl.lesson)) {
    if (str(refl.walrus_blob_id)) refs.push({ walrusBlobId: str(refl.walrus_blob_id)! });
    return {
      answer: `My most recent reflection: ${str(refl.lesson)}${
        str(refl.failed) ? ` What didn't work: ${str(refl.failed)}.` : ""
      } It's anchored on Walrus so you can verify I didn't rewrite it.`,
      refs,
    };
  }
  if (wantsTrade) {
    const trades = Array.isArray(c.settled_trades) ? (c.settled_trades as Rec[]) : [];
    const last = trades[0];
    if (last) {
      const tx = str(last.tx_digest);
      if (tx) refs.push({ txDigest: tx });
      const oc = num(last.outcome_pct);
      return {
        answer:
          `My most recent allocation move was a ${str(last.side) ?? "trade"} on ${str(last.asset) ?? "the asset"}` +
          `${oc != null ? `, which settled ${(oc * 100).toFixed(2)}% (fee-inclusive)` : ", currently settling"}. ` +
          `Every move is a real on-chain transaction you can verify.`,
        refs,
      };
    }
  }
  // Default · current stance.
  const line = str(stance.line);
  const dd = num(stats.worst_drawdown_pct);
  return {
    answer:
      `${line ? `Right now: ${line}.` : `I'm ${name}, watching the market and holding a measured stance.`}` +
      `${str(asRec(stance.plan).why) ? ` ${str(asRec(stance.plan).why)}` : ""}` +
      `${dd != null ? ` My worst drawdown so far is ${dd.toFixed(1)}%.` : ""}` +
      ` I only act when the edge clears my bar, and I can never break the policy the chain enforces.`,
    refs,
  };
}

export type Ref = { txDigest?: string; walrusBlobId?: string };
