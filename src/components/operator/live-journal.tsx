// Live Journal · the core product loop. Every operator decision, hold, trade,
// guardian move, and Walrus anchor becomes a human-readable receipt. This is the
// center of the dashboard: it makes "holding" read as a managed stance, not
// inactivity, and keeps proof one click away without looking like a block
// explorer.

"use client";

import { useEffect, useMemo, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import { BRIEF_NETWORK } from "@/lib/brief-client";
import {
  buildJournal,
  type FeedDecision,
  type FeedLedger,
} from "@/lib/operator-feed";
import type { AgentStreamState } from "@/lib/use-agent-stream";

import { JournalEntryCard } from "./journal-entry-card";

const NETWORK: "mainnet" | "testnet" = BRIEF_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** Fetch the FULL decision archive (with detail: plan, verdict, guardian, walrus)
 *  · the scorecard hook slims these, so the journal fetches its own copy. */
function useDecisionArchive(policyId: string | null | undefined): FeedDecision[] {
  const [recs, setRecs] = useState<FeedDecision[]>([]);
  useEffect(() => {
    if (!policyId || !policyId.startsWith("0x")) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          apiUrl(`/api/operators/decisions?policy_id=${encodeURIComponent(policyId)}`),
        );
        const j = (await r.json()) as { decisions?: FeedDecision[] };
        if (!cancelled) setRecs(Array.isArray(j.decisions) ? j.decisions : []);
      } catch {
        /* keep last */
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [policyId]);
  return recs;
}

export function LiveJournal({
  policyId,
  stream,
  ledger,
  name,
  role,
  asset,
  now,
}: {
  policyId: string | null | undefined;
  stream: AgentStreamState;
  ledger: FeedLedger[];
  name: string;
  role: string;
  asset?: string | null;
  now: number;
}) {
  const decisions = useDecisionArchive(policyId);

  const entries = useMemo(
    () =>
      buildJournal({
        // newest-first archive · cap before mapping to keep it cheap on long histories
        decisions: decisions.slice(0, 80),
        ledger,
        stream,
        ctx: { name, role, asset, policyId, network: NETWORK },
        limit: 60,
      }),
    // rebuild only when the data changes · `now` is for relative time in cards
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decisions, ledger, stream.lastEventTs, stream.decision, name, role, asset, policyId],
  );

  return (
    <section className="mt-6 bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <header
        className="flex items-center justify-between px-5 py-3.5 sm:px-6"
        style={{ borderBottom: "1px solid #E5E5EA" }}
      >
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: "#1a2c4e" }}>
            Live journal
          </span>
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
          Every decision, a receipt
        </span>
      </header>

      {entries.length === 0 ? (
        <div className="px-5 py-10 text-center sm:px-6">
          <p className="font-sans text-[14px] font-medium text-ink">
            {name} is getting ready.
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-ink-2">
            Once your operator starts watching the market, every decision will appear here as a
            receipt · what it did, why, what it is watching next, and proof on-chain.
          </p>
        </div>
      ) : (
        <div className="max-h-[640px] space-y-2 overflow-y-auto p-3 sm:p-4">
          {entries.map((e) => (
            <JournalEntryCard key={e.id} entry={e} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
