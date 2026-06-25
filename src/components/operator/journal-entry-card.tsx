// One Live Journal entry · a human-first receipt for one operator action.
// Human first, verifiable second: the title + body read like a person narrating
// the operator; proof (Suiscan / Walrus) is a small "Verify" link, not a block
// explorer.

"use client";

import {
  suiscanTxUrl,
  walrusBlobUrl,
  type JournalEntry,
  type JournalStatus,
} from "@/lib/operator-feed";

const STATUS_BAR: Record<JournalStatus, string> = {
  neutral: "#C7C7CC",
  good: "#10B981",
  caution: "#F59E0B",
  danger: "#EF4444",
};

const TYPE_LABEL: Record<string, string> = {
  decision: "Decision",
  trade: "Trade",
  hold: "Hold",
  risk: "Risk",
  proof: "Proof",
  memory: "Memory",
  policy: "Policy",
  error: "Error",
};

function relTime(ts: number, now: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function PlanRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      <span className="text-[12px] leading-snug text-ink-2">{value}</span>
    </div>
  );
}

export function JournalEntryCard({ entry, now }: { entry: JournalEntry; now: number }) {
  const bar = STATUS_BAR[entry.status];
  const p = entry.proof;
  const net = p?.network ?? "mainnet";
  const hasProof = !!(p && (p.txDigest || p.walrusBlobId));

  return (
    <article
      className="border-l-2 bg-bg-elev py-3 pl-4 pr-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      style={{ borderColor: bar }}
    >
      <header className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: bar }}>
          {TYPE_LABEL[entry.type] ?? entry.type}
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-muted">{relTime(entry.ts, now)}</span>
      </header>

      <h4 className="mt-1.5 font-sans text-[14px] font-semibold leading-snug tracking-tight text-ink">
        {entry.title}
      </h4>
      {entry.body && (
        <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{entry.body}</p>
      )}

      {entry.plan && (
        <div className="mt-2.5 space-y-1 border-l border-line pl-3">
          <PlanRow label="Watching" value={entry.plan.watching} />
          <PlanRow label="Will act when" value={entry.plan.willActWhen} />
          <PlanRow label="Will stop if" value={entry.plan.willStopIf} />
        </div>
      )}

      {(entry.chips.length > 0 || hasProof) && (
        <footer className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {entry.chips.map((c) => (
            <span
              key={c}
              className="border border-line px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted"
            >
              {c}
            </span>
          ))}
          {p?.txDigest && (
            <a
              href={suiscanTxUrl(p.txDigest, net)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-700 transition-opacity hover:opacity-60"
            >
              Verify trade ↗
            </a>
          )}
          {p?.walrusBlobId && (
            <a
              href={walrusBlobUrl(p.walrusBlobId)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted transition-opacity hover:opacity-60"
              style={{ color: "#1a2c4e" }}
            >
              Reasoning on Walrus ↗
            </a>
          )}
        </footer>
      )}
    </article>
  );
}
