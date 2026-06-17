// MindVolSmile · the live SVI smile read from DeepBook Predict's
// on-chain oracle, with the current strike pinned. This is the curve
// the quant strategy prices against; rendering it live is the single
// strongest "this agent is real" frame in the product.

"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SmilePoint, SviSurface } from "@/lib/svi";
import { C, MONO_TICK, fmtUsd } from "./theme";

function SmileTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: SmilePoint }>;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="border border-line bg-bg-elev px-2.5 py-2 font-mono text-[10.5px] shadow-sm">
      <p className="tabular-nums text-ink">iv {p.ivPct.toFixed(1)}%</p>
      <p className="tabular-nums text-muted">K {fmtUsd(p.strikeUsd, 0)}</p>
    </div>
  );
}

export function MindVolSmile({
  smile,
  surface,
  strikeKValue,
  strikeUsd,
}: {
  smile: SmilePoint[];
  surface: SviSurface | null;
  strikeKValue: number | null;
  strikeUsd: number | null;
}) {
  const strikeIv = useMemo(() => {
    if (strikeKValue === null || smile.length === 0) return null;
    let best: SmilePoint | null = null;
    for (const p of smile) {
      if (!best || Math.abs(p.k - strikeKValue) < Math.abs(best.k - strikeKValue)) {
        best = p;
      }
    }
    return best;
  }, [smile, strikeKValue]);

  const expiryLabel = useMemo(() => {
    if (!surface) return null;
    const mins = Math.max(0, Math.round((surface.expiryMs - Date.now()) / 60_000));
    return mins > 0 ? `expires in ~${mins}m` : "at expiry";
  }, [surface]);

  if (smile.length < 5 || !surface) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center border border-line bg-bg-elev-2/40">
        <p className="px-6 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          SVI smile renders when a BTC oracle is live
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line bg-bg-elev px-2 pb-2 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          SVI vol smile · live from the oracle
        </p>
        <p className="font-mono text-[9.5px] tracking-[0.04em] text-muted">
          F {fmtUsd(surface.forwardUsd, 0)}
          {expiryLabel ? ` · ${expiryLabel}` : ""}
        </p>
      </div>
      <div className="mt-2 h-[176px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={smile} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="smileFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.accent} stopOpacity={0.14} />
                <stop offset="100%" stopColor={C.accent} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="k"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(k: number) => `${k >= 0 ? "+" : ""}${(k * 100).toFixed(0)}%`}
              tick={MONO_TICK}
              tickLine={false}
              axisLine={{ stroke: C.line }}
              minTickGap={42}
            />
            <YAxis
              dataKey="ivPct"
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={MONO_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip content={<SmileTooltip />} cursor={{ stroke: C.muted2 }} />
            {strikeKValue !== null && (
              <ReferenceLine
                x={strikeKValue}
                stroke={C.ink}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: strikeUsd ? `strike ${fmtUsd(strikeUsd, 0)}` : "strike",
                  position: "insideTopLeft",
                  ...MONO_TICK,
                  fill: C.ink,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="ivPct"
              stroke={C.accent}
              strokeWidth={1.6}
              fill="url(#smileFill)"
              isAnimationActive={false}
            />
            {strikeIv && (
              <ReferenceDot
                x={strikeIv.k}
                y={strikeIv.ivPct}
                r={3.5}
                fill={C.ink}
                stroke="#FFFFFF"
                strokeWidth={1.5}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-1 font-mono text-[9.5px] tabular-nums tracking-[0.04em] text-muted">
        <span>a={surface.a.toFixed(5)}</span>
        <span>b={surface.b.toFixed(5)}</span>
        <span>ρ={surface.rho.toFixed(3)}</span>
        <span>m={surface.m.toFixed(4)}</span>
        <span>σ={surface.sigma.toFixed(4)}</span>
        <span className="text-emerald-800">· read on-chain via devInspect</span>
      </div>
    </div>
  );
}
