"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { DecodedWorkObject } from "@/lib/work-object";
import { decodePayload, fetchWalrusPayload } from "@/lib/work-object";

type GuardianWarning = {
  kind: "slippage" | "concentration" | "stale_pool";
  severity: "info" | "amber" | "red";
  message: string;
};

type StrategyPayload = {
  allocation: Record<string, number>;
  projected_30d_yield: number;
  guardian_warnings: GuardianWarning[];
  ptb_intent: {
    operations: { op: string; protocol: string; amount_pct: number }[];
  };
};

const SEVERITY_COLORS: Record<
  GuardianWarning["severity"],
  { dot: string; text: string; bg: string }
> = {
  info: { dot: "bg-muted", text: "text-ink-2", bg: "bg-bg-elev" },
  amber: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  red: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
};

export function GuardianPanel({
  strategy,
  onConfirm,
  confirming = false,
}: {
  strategy: DecodedWorkObject;
  onConfirm?: () => void;
  confirming?: boolean;
}) {
  const [parsed, setParsed] = useState<StrategyPayload | null>(null);

  useEffect(() => {
    if (strategy.payloadBytes) {
      try {
        setParsed(decodePayload<StrategyPayload>(strategy.payloadBytes));
      } catch {
        setParsed(null);
      }
      return;
    }
    if (strategy.walrusBlobId) {
      const ctl = new AbortController();
      fetchWalrusPayload<StrategyPayload>(strategy.walrusBlobId, ctl.signal)
        .then((data) => setParsed(data))
        .catch(() => setParsed(null));
      return () => ctl.abort();
    }
  }, [strategy.payloadBytes, strategy.walrusBlobId]);

  if (!parsed) {
    return (
      <div className="rounded-[14px] border border-dashed border-line bg-bg-elev p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          loading guardian check…
        </p>
      </div>
    );
  }

  const warnings = parsed.guardian_warnings ?? [];

  return (
    <div className="rounded-[14px] border border-line bg-bg-elev p-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          Guardian check
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          before you sign
        </span>
      </div>

      <h3 className="mt-3 text-[18px] font-medium text-ink">
        Review and confirm execution
      </h3>

      <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-2">
        The Strategy agent compiled this plan from your Research. Confirm to
        sign the execution transaction. The Execution agent will only run once
        this confirmation is on-chain.
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[12.5px]">
        <div>
          <dt className="font-mono uppercase tracking-[0.18em] text-muted">Projected 30-day</dt>
          <dd className="mt-1 font-mono text-ink">
            +{(parsed.projected_30d_yield * 100).toFixed(2)}%
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.18em] text-muted">Operations</dt>
          <dd className="mt-1 font-mono text-ink">
            {parsed.ptb_intent?.operations?.length ?? 0}
          </dd>
        </div>
      </dl>

      <div className="mt-6">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {warnings.length === 0 ? "No warnings" : `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
        </h4>
        <ul className="mt-3 flex flex-col gap-2">
          {warnings.length === 0 ? (
            <li className="inline-flex items-center gap-2 text-[13.5px] text-ink-2">
              <ShieldCheck className="h-4 w-4 text-green-600" strokeWidth={1.75} />
              No slippage, concentration, or stale-pool issues detected.
            </li>
          ) : (
            warnings.map((w, i) => {
              const c = SEVERITY_COLORS[w.severity] ?? SEVERITY_COLORS.amber;
              return (
                <li
                  key={i}
                  className={`flex items-start gap-3 rounded-[10px] border border-line p-3 ${c.bg}`}
                >
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 ${c.text}`}
                    strokeWidth={1.75}
                  />
                  <div>
                    <p className={`font-mono text-[10.5px] uppercase tracking-[0.16em] ${c.text}`}>
                      {w.kind.replace("_", " ")} &middot; {w.severity}
                    </p>
                    <p className="mt-1 text-[13.5px] leading-[1.5] text-ink-2">
                      {w.message}
                    </p>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {onConfirm ? (
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-bg transition-transform hover:-translate-y-px disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {confirming ? "Signing…" : "Confirm execution"}
        </button>
      ) : null}
    </div>
  );
}
