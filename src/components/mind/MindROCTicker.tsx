// MindROCTicker — momentum at a glance: the headline rate-of-change
// number plus a bar strip of short-window ROC across the last hour,
// so "the tape is heating up" is visible before the agent acts on it.

"use client";

import { useMemo } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer } from "recharts";

import type { SeriesPoint } from "@/lib/use-mind-data";
import { C } from "./theme";

export function MindROCTicker({
  points,
  roc,
  rocWindow,
}: {
  points: SeriesPoint[];
  roc: number | null;
  rocWindow: string;
}) {
  // Per-point 5-minute ROC over the series — the strip under the number.
  const bars = useMemo(() => {
    const out: Array<{ ts: number; roc: number }> = [];
    for (let i = 0; i < points.length; i++) {
      const cur = points[i]!;
      let past: SeriesPoint | null = null;
      for (let j = i; j >= 0; j--) {
        if (points[j]!.ts <= cur.ts - 5 * 60_000) {
          past = points[j]!;
          break;
        }
      }
      if (!past || past.price === 0) continue;
      out.push({ ts: cur.ts, roc: ((cur.price - past.price) / past.price) * 100 });
    }
    return out.slice(-40);
  }, [points]);

  const pct = roc === null ? null : roc * 100;
  const tone =
    pct === null ? "text-muted" : pct > 0 ? "text-emerald-700" : pct < 0 ? "text-red-700" : "text-ink";

  return (
    <div className="flex h-full flex-col justify-between border border-line bg-bg-elev px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          Momentum · ROC {rocWindow}
        </p>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
          rate of change
        </p>
      </div>

      <p
        key={pct === null ? "na" : pct.toFixed(3)}
        className={`mt-2 font-sans text-[40px] font-medium leading-none tabular-nums tracking-tighter ${tone} animate-value-tick`}
      >
        {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%`}
      </p>

      <div className="mt-4 h-[56px] w-full">
        {bars.length >= 3 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <ReferenceLine y={0} stroke={C.line} strokeWidth={1} />
              <Bar dataKey="roc" isAnimationActive={false}>
                {bars.map((b) => (
                  <Cell key={b.ts} fill={b.roc >= 0 ? C.up : C.down} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center border border-line bg-bg-elev-2/40">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
              strip fills as history lands
            </p>
          </div>
        )}
      </div>

      <p className="mt-3 font-mono text-[9.5px] leading-relaxed tracking-[0.04em] text-muted">
        5-minute rate of change, bar by bar. The momentum strategy rides
        this; the quant only cares when it disagrees with the market.
      </p>
    </div>
  );
}
