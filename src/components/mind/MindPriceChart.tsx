// MindPriceChart — the agent's 60-minute world: live spot, the two
// SMAs its strategies compare, and the strike line the bet lives or
// dies on. Every series comes from the same .cursors price history the
// trader computed its signals from — nothing here is decorative.

"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SeriesPoint, TradeDecision } from "@/lib/use-mind-data";
import { C, MONO_TICK, fmtClock, fmtUsd } from "./theme";

// Decision marker — a real past decision plotted at (ts, spot). Up bets
// are emerald ▲ at the price, down bets red ▼, honest abstentions a
// hollow ○ in muted. Custom ReferenceDot shape so it renders inside the
// LineChart; native <title> gives hover detail without touching the
// line's own tooltip.
function MarkerShape(props: {
  cx?: number;
  cy?: number;
  decision: TradeDecision;
}) {
  const { cx, cy, decision } = props;
  if (cx == null || cy == null) return null;
  const title = `${
    decision.abstained
      ? "abstained"
      : `${decision.quantity} ${decision.direction?.toUpperCase() ?? ""}`
  } · ${decision.strategy} · ${decision.mode}${
    decision.mint_tx ? ` · ${decision.mint_tx.slice(0, 8)}…` : ""
  }`;
  if (decision.abstained) {
    return (
      <g>
        <title>{title}</title>
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="#FFFFFF"
          stroke={C.muted}
          strokeWidth={1.4}
        />
      </g>
    );
  }
  const up = decision.direction !== "down";
  const color = up ? C.up : C.down;
  // Triangle pointing up (bet UP) or down (bet DOWN), apex on the point.
  const d = up
    ? `M ${cx} ${cy - 6} L ${cx - 5} ${cy + 4} L ${cx + 5} ${cy + 4} Z`
    : `M ${cx} ${cy + 6} L ${cx - 5} ${cy - 4} L ${cx + 5} ${cy - 4} Z`;
  return (
    <g>
      <title>{title}</title>
      <path d={d} fill={color} stroke="#FFFFFF" strokeWidth={1} />
    </g>
  );
}

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
  decisions = [],
}: {
  points: SeriesPoint[];
  liveSpotUsd?: number | null;
  strikeUsd?: number | null;
  direction?: "up" | "down" | null;
  asset: string;
  decisions?: TradeDecision[];
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

  // Markers: real past decisions that fall inside the visible window,
  // plotted at the spot they were taken (fall back to strike).
  const markers = useMemo(() => {
    if (data.length === 0) return [];
    const startTs = data[0]!.ts;
    return decisions
      .filter((d) => d.ts >= startTs && (d.spot_usd != null || d.strike_usd != null))
      .map((d) => ({ d, y: (d.spot_usd ?? d.strike_usd)! }))
      .slice(-12);
  }, [decisions, data]);

  const domain = useMemo<[number, number] | null>(() => {
    const vals = data
      .flatMap((d) => [d.price, d.sma15 ?? d.price, d.sma60 ?? d.price])
      .concat(strikeUsd && strikeUsd > 0 ? [strikeUsd] : [])
      .concat(markers.map((m) => m.y));
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.18, max * 0.0004);
    return [min - pad, max + pad];
  }, [data, strikeUsd, markers]);

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
          {markers.length > 0 && (
            <>
              {"  "}
              <span style={{ color: C.up }}>▲</span>
              <span style={{ color: C.down }}>▼</span>
              <span> decisions</span>
            </>
          )}
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
            {markers.map((m) => (
              <ReferenceDot
                key={`${m.d.task_id}-${m.d.ts}`}
                x={m.d.ts}
                y={m.y}
                r={0}
                shape={<MarkerShape decision={m.d} />}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
