// MindPriceChart — the agent's 60-minute world: live spot, the two
// SMAs its strategies compare, and the strike line the bet lives or
// dies on. Every series comes from the same .cursors price history the
// trader computed its signals from — nothing here is decorative.

"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SeriesPoint } from "@/lib/use-mind-data";
import { C, MONO_TICK, fmtClock, fmtUsd } from "./theme";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-line bg-bg-elev px-2.5 py-2 font-mono text-[10.5px] shadow-sm">
      <p className="text-muted">{label ? fmtClock(label) : ""}</p>
      {payload.map((p) => (
        <p key={p.name} className="tabular-nums text-ink">
          {p.name}: {typeof p.value === "number" ? fmtUsd(p.value, 2) : p.value}
        </p>
      ))}
    </div>
  );
}

export function MindPriceChart({
  points,
  liveSpotUsd,
  strikeUsd,
  direction,
  asset,
}: {
  points: SeriesPoint[];
  liveSpotUsd?: number | null;
  strikeUsd?: number | null;
  direction?: "up" | "down" | null;
  asset: string;
}) {
  const data = useMemo(() => {
    const base = points.map((p) => ({
      ts: p.ts,
      price: p.price,
      sma15: p.sma15,
      sma60: p.sma60,
    }));
    // Splice the freshest devInspected spot in as the last point so the
    // line touches "now" even between 60s history polls.
    if (
      liveSpotUsd &&
      liveSpotUsd > 0 &&
      (base.length === 0 || base[base.length - 1]!.ts < Date.now() - 20_000)
    ) {
      base.push({
        ts: Date.now(),
        price: liveSpotUsd,
        sma15: base[base.length - 1]?.sma15 ?? null,
        sma60: base[base.length - 1]?.sma60 ?? null,
      });
    }
    return base;
  }, [points, liveSpotUsd]);

  const domain = useMemo<[number, number] | null>(() => {
    const vals = data
      .flatMap((d) => [d.price, d.sma15 ?? d.price, d.sma60 ?? d.price])
      .concat(strikeUsd && strikeUsd > 0 ? [strikeUsd] : []);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.18, max * 0.0004);
    return [min - pad, max + pad];
  }, [data, strikeUsd]);

  if (data.length < 2) {
    return (
      <div className="flex h-[240px] items-center justify-center border border-line bg-bg-elev-2/40">
        <p className="px-6 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          {asset} history warming up — the first points land within a minute
        </p>
      </div>
    );
  }

  const strikeColor = direction === "down" ? C.down : C.up;

  return (
    <div className="border border-line bg-bg-elev px-2 pb-1 pt-3">
      <div className="flex items-baseline justify-between px-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          {asset} · last hour the agent saw
        </p>
        <p className="font-mono text-[10px] tracking-[0.04em] text-muted">
          <span className="text-ink">— spot</span>
          {"  "}
          <span style={{ color: C.sui }}>— sma15</span>
          {"  "}
          <span style={{ color: C.accent }}>— sma60</span>
        </p>
      </div>
      <div className="mt-2 h-[210px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtClock}
              tick={MONO_TICK}
              tickLine={false}
              axisLine={{ stroke: C.line }}
              minTickGap={48}
            />
            <YAxis
              domain={domain ?? ["auto", "auto"]}
              tickFormatter={(v: number) => fmtUsd(v, v >= 1000 ? 0 : 3)}
              tick={MONO_TICK}
              tickLine={false}
              axisLine={false}
              width={62}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: C.muted2 }} />
            {strikeUsd && strikeUsd > 0 && (
              <ReferenceLine
                y={strikeUsd}
                stroke={strikeColor}
                strokeDasharray="5 4"
                strokeWidth={1.2}
                label={{
                  value: `strike ${fmtUsd(strikeUsd, 0)}`,
                  position: "insideTopRight",
                  ...MONO_TICK,
                  fill: strikeColor,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="sma15"
              name="sma15"
              stroke={C.sui}
              strokeWidth={1}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="sma60"
              name="sma60"
              stroke={C.accent}
              strokeWidth={1.2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="price"
              name="spot"
              stroke={C.ink}
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
