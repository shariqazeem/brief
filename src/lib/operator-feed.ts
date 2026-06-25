// Operator Journal feed · the core product loop, made human.
//
// Every AI money decision needs a receipt. This module turns the raw data Brief
// already produces (the decision archive, the on-chain ledger, the live SSE
// wire) into a normalized, frontend-friendly JournalEntry stream, with a
// deterministic formatter (no LLM) that reads like a person narrating the
// operator's work: what it did, why, what it is watching, and that the money
// stayed protected. AI proposes, Sui enforces · the journal makes both legible.

import type { AgentStreamState } from "@/lib/use-agent-stream";

export type JournalType =
  | "decision"
  | "trade"
  | "hold"
  | "risk"
  | "proof"
  | "memory"
  | "policy"
  | "error";

export type JournalStatus = "neutral" | "good" | "caution" | "danger";

export type JournalProof = {
  txDigest?: string | null;
  walrusBlobId?: string | null;
  policyId?: string | null;
  venue?: string | null;
  network?: "mainnet" | "testnet";
};

export type JournalPlan = {
  watching?: string;
  willActWhen?: string;
  willStopIf?: string;
};

export type JournalMetrics = {
  confidencePct?: number;
  allocationPct?: number; // current exposure to the asset
  targetExposurePct?: number | null;
  capitalPreservedPct?: number;
  budgetUsedPct?: number;
};

export type JournalEntry = {
  id: string;
  ts: number;
  operatorName: string;
  operatorRole: string;
  type: JournalType;
  status: JournalStatus;
  title: string;
  body: string;
  chips: string[];
  proof?: JournalProof;
  plan?: JournalPlan;
  metrics?: JournalMetrics;
  raw?: unknown; // debugging only
};

export type JournalCtx = {
  name: string;
  role: string;
  asset?: string | null;
  policyId?: string | null;
  network?: "mainnet" | "testnet";
};

// ── Raw shapes (loosely typed · resilient to archive drift) ──────────────────

type FeedPlan = {
  now?: string;
  why?: string;
  watching?: string;
  willActWhen?: string;
  willStopIf?: string;
};

type FeedDecisionDetail = {
  regimeLabel?: string;
  verdict?: string;
  thesis?: string;
  counterargument?: string;
  guardianPaused?: boolean; // true only at a crash-level stop
  guardianReason?: string | null;
  aiReasoned?: boolean;
  aiBlobId?: string | null;
  plan?: FeedPlan;
};

export type FeedDecision = {
  ts?: number;
  seq?: number;
  regimeKind?: string;
  regimeLabel?: string;
  direction?: "up" | "down";
  asset?: string;
  decided?: boolean;
  targetExposurePct?: number | null;
  confidence?: number;
  mid?: number;
  outcome?: string;
  outcomePct?: number;
  detail?: FeedDecisionDetail;
};

export type FeedLedger = {
  ts?: number;
  seq?: number;
  side?: "buy" | "sell";
  mid?: number;
  qtySui?: number;
  reason?: string;
  txDigest?: string | null;
  outcome?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const stripDot = (s: string) => s.replace(/\.\s*$/, "");

/** Role-aware "what it is doing right now" headline · makes holding feel like a
 *  managed stance, not inactivity. Exported so the dashboard hero reuses it. */
export function roleHeadline(name: string, role: string): string {
  const r = (role || "").toLowerCase();
  if (r.includes("guardian") || r.includes("capital"))
    return `${name} is protecting your capital.`;
  if (r.includes("momentum")) return `${name} is holding its momentum stance.`;
  if (r.includes("experimental") || r.includes("learner"))
    return `${name} is observing and learning.`;
  if (r.includes("macro")) return `${name} is watching the bigger picture.`;
  return `${name} is managing your capital.`;
}

const SUISCAN = {
  mainnet: "https://suiscan.xyz/mainnet/tx/",
  testnet: "https://suiscan.xyz/testnet/tx/",
};
const WALRUS_AGG = "https://aggregator.walrus-testnet.walrus.space/v1/blobs/";

export function suiscanTxUrl(digest: string, network: "mainnet" | "testnet" = "mainnet"): string {
  return `${SUISCAN[network]}${digest}`;
}
export function walrusBlobUrl(blobId: string): string {
  return `${WALRUS_AGG}${blobId}`;
}

/** Find the on-chain trade that corresponds to a decided decision (nearest
 *  ledger fill on the same side within a window) · gives the entry its Suiscan
 *  proof. The decision archive stores txDigest=null for spot, so the tx lives
 *  in the ledger. */
function matchLedgerTx(rec: FeedDecision, ledger: FeedLedger[], windowMs = 180_000): string | null {
  const ts = rec.ts ?? 0;
  if (!ts) return null;
  const wantSide = rec.direction === "up" ? "buy" : "sell";
  let best: { d: number; tx: string } | null = null;
  for (const l of ledger) {
    if (!l.txDigest || !l.ts) continue;
    if (l.side && l.side !== wantSide) continue;
    const d = Math.abs(l.ts - ts);
    if (d <= windowMs && (best == null || d < best.d)) best = { d, tx: l.txDigest };
  }
  return best?.tx ?? null;
}

function planFrom(p: FeedPlan | undefined): JournalPlan | undefined {
  if (!p) return undefined;
  const out: JournalPlan = {};
  if (p.watching) out.watching = p.watching;
  if (p.willActWhen) out.willActWhen = p.willActWhen;
  if (p.willStopIf) out.willStopIf = p.willStopIf;
  return out.watching || out.willActWhen || out.willStopIf ? out : undefined;
}

// ── Builders ─────────────────────────────────────────────────────────────────

/** One decision record (from the archive) → a journal entry. Covers hold,
 *  trade and risk in one place; guardian + memory fold in as status + proof. */
export function journalFromDecision(
  rec: FeedDecision,
  ctx: JournalCtx,
  ledger: FeedLedger[] = [],
): JournalEntry {
  const d = rec.detail ?? {};
  const plan = d.plan ?? {};
  const asset = rec.asset ?? ctx.asset ?? "SUI";
  const name = ctx.name;
  const decided = rec.decided === true;
  const guardianReason = d.guardianReason ?? null;
  const crash = d.guardianPaused === true;
  const confidencePct = rec.confidence != null ? Math.round(rec.confidence * 100) : undefined;
  const venue = `spot-${asset.toLowerCase()}`;

  const chips: string[] = [];
  const regimeLabel = d.regimeLabel ?? rec.regimeLabel;
  if (regimeLabel) chips.push(regimeLabel);
  if (confidencePct != null) chips.push(`${confidencePct}% conviction`);

  let type: JournalType;
  let status: JournalStatus;
  let title: string;
  let body: string;
  let proof: JournalProof | undefined;

  if (decided) {
    type = "trade";
    status = "good";
    title = rec.direction === "up" ? `${name} added to ${asset}.` : `${name} trimmed ${asset}.`;
    body =
      "The policy check passed, the budget was recorded on-chain, and the DeepBook order landed." +
      (plan.why ? ` ${plan.why}` : "");
    proof = {
      txDigest: matchLedgerTx(rec, ledger),
      walrusBlobId: d.aiBlobId ?? null,
      policyId: ctx.policyId ?? null,
      venue,
      network: ctx.network ?? "mainnet",
    };
    if (d.aiReasoned) chips.push("AI reasoned");
  } else if (crash || guardianReason) {
    type = "risk";
    status = crash ? "danger" : "caution";
    title = crash
      ? `Risk Guardian moved ${name} to cash.`
      : `Risk Guardian reduced ${name}'s room.`;
    body =
      guardianReason ??
      "Volatility moved into the elevated band, so new exposure is smaller until risk cools.";
    if (d.aiBlobId) proof = { walrusBlobId: d.aiBlobId, network: ctx.network ?? "mainnet" };
  } else {
    type = "hold";
    status = "neutral";
    title = plan.now
      ? `${name} ${stripDot(plan.now).replace(/^Holding/i, "is holding")}`
      : roleHeadline(name, ctx.role);
    body = plan.why ?? d.verdict ?? "Keeping the current stance · no clear edge yet.";
    if (d.aiBlobId) proof = { walrusBlobId: d.aiBlobId, network: ctx.network ?? "mainnet" };
  }

  return {
    id: `dec-${rec.seq ?? rec.ts ?? 0}`,
    ts: rec.ts ?? 0,
    operatorName: name,
    operatorRole: ctx.role,
    type,
    status,
    title,
    body,
    chips: chips.slice(0, 3),
    proof,
    plan: planFrom(plan),
    metrics: { confidencePct, targetExposurePct: rec.targetExposurePct ?? null },
    raw: rec,
  };
}

/** A live SSE event (guardian / walrus / error) → a journal entry, or null when
 *  the event type is already covered by the decision entries. */
export function journalFromStreamEvent(
  evt: { ts: number; seq: number; type: string; data?: Record<string, unknown> },
  ctx: JournalCtx,
): JournalEntry | null {
  const name = ctx.name;
  const data = evt.data ?? {};
  const base = { ts: evt.ts, operatorName: name, operatorRole: ctx.role, chips: [] as string[] };
  switch (evt.type) {
    case "guardian_pause":
      return {
        ...base,
        id: `ev-${evt.seq}`,
        type: "risk",
        status: "danger",
        title: `Risk Guardian paused ${name}.`,
        body: (data.reason as string) ?? "Risk rose past the limit. New exposure is on hold.",
      };
    case "guardian_resume":
      return {
        ...base,
        id: `ev-${evt.seq}`,
        type: "risk",
        status: "good",
        title: `Risk Guardian resumed ${name}.`,
        body: (data.reason as string) ?? "Risk is back within limits. The operator can act again.",
      };
    case "walrus_uploaded":
      return {
        ...base,
        id: `ev-${evt.seq}`,
        type: "memory",
        status: "neutral",
        title: "Reasoning anchored to Walrus.",
        body: "This decision can be replayed even if the server disappears.",
        proof: { walrusBlobId: (data.blob_id as string) ?? null, network: ctx.network ?? "mainnet" },
      };
    case "mint_failed":
    case "task_failed":
      return {
        ...base,
        id: `ev-${evt.seq}`,
        type: "error",
        status: "danger",
        title: "Trade rejected by policy.",
        body:
          (data.error as string) ??
          "Move aborted before the order landed. No funds moved · the leash held.",
      };
    default:
      return null;
  }
}

/** The live decision from the SSE wire → a journal entry (freshest, before the
 *  archive poll catches up). Mirrors journalFromDecision over the stream shape. */
export function journalFromStreamDecision(
  stream: AgentStreamState,
  ctx: JournalCtx,
): JournalEntry | null {
  const dec = stream.decision;
  if (!dec) return null;
  const asset = dec.asset ?? ctx.asset ?? "SUI";
  const name = ctx.name;
  const decided = dec.decided === true;
  const crash = dec.guardianPaused === true;
  const guardianReason = dec.guardianReason ?? null;
  const confidencePct = dec.conviction != null ? Math.round(dec.conviction * 100) : undefined;
  const plan = dec.plan ?? null;
  const venue = `spot-${asset.toLowerCase()}`;

  const chips: string[] = [];
  if (dec.regimeLabel) chips.push(dec.regimeLabel);
  if (confidencePct != null) chips.push(`${confidencePct}% conviction`);

  let type: JournalType;
  let status: JournalStatus;
  let title: string;
  let body: string;
  let proof: JournalProof | undefined;

  if (decided) {
    type = "trade";
    status = "good";
    title = dec.direction === "up" ? `${name} added to ${asset}.` : `${name} trimmed ${asset}.`;
    body =
      "The policy check passed, the budget was recorded on-chain, and the DeepBook order landed." +
      (plan?.why ? ` ${plan.why}` : "");
    proof = {
      txDigest: stream.mintTx ?? stream.deliveredTx ?? null,
      walrusBlobId: stream.walrusReasoningBlobId ?? null,
      policyId: ctx.policyId ?? null,
      venue,
      network: ctx.network ?? "mainnet",
    };
  } else if (crash || guardianReason) {
    type = "risk";
    status = crash ? "danger" : "caution";
    title = crash
      ? `Risk Guardian moved ${name} to cash.`
      : `Risk Guardian reduced ${name}'s room.`;
    body =
      guardianReason ??
      "Volatility moved into the elevated band, so new exposure is smaller until risk cools.";
  } else {
    type = "hold";
    status = "neutral";
    title = plan?.now
      ? `${name} ${stripDot(plan.now).replace(/^Holding/i, "is holding")}`
      : roleHeadline(name, ctx.role);
    body = plan?.why ?? dec.verdict ?? "Keeping the current stance · no clear edge yet.";
  }

  return {
    id: `live-${stream.lastEventTs}`,
    ts: stream.lastEventTs,
    operatorName: name,
    operatorRole: ctx.role,
    type,
    status,
    title,
    body,
    chips: chips.slice(0, 3),
    proof,
    plan: plan
      ? planFrom({ watching: plan.watching, willActWhen: plan.willActWhen, willStopIf: plan.willStopIf })
      : undefined,
    metrics: {
      confidencePct,
      allocationPct: dec.currentExposurePct ?? undefined,
      targetExposurePct: dec.targetExposurePct ?? null,
    },
    raw: dec,
  };
}

/** Merge the archive, ledger and live wire into one newest-first journal. */
export function buildJournal(args: {
  decisions: FeedDecision[];
  ledger?: FeedLedger[];
  stream?: AgentStreamState | null;
  ctx: JournalCtx;
  limit?: number;
}): JournalEntry[] {
  const { decisions, ledger = [], stream, ctx, limit = 60 } = args;
  const archive = decisions.map((r) => journalFromDecision(r, ctx, ledger));
  const headTs = archive.length ? Math.max(...archive.map((e) => e.ts)) : 0;

  const live: JournalEntry[] = [];
  if (stream) {
    // Only add the live decision when it is newer than the archive head (so it
    // shows instantly, then dedupes once the 15s archive poll catches up).
    const liveDec = journalFromStreamDecision(stream, ctx);
    if (liveDec && liveDec.ts > headTs + 2000) live.push(liveDec);
    for (const e of stream.events ?? []) {
      if (e.ts <= headTs) continue;
      const j = journalFromStreamEvent(e, ctx);
      if (j) live.push(j);
    }
  }

  const seen = new Set<string>();
  return [...live, ...archive]
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}
