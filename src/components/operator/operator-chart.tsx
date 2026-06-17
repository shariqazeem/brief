// OperatorChart · the clinical price tape under the decision cascade.
//
// Thin #111 price line over a faint #F5F5F5 fill, SMA-15/60 as dashed
// #CCC, the strike as a dotted #EF4444 line, and each past decision as a
// small marker (emerald = acted UP, red = acted DOWN, amber = preserved).
// No grid lines. Lazy-loaded so recharts stays out of the first bundle.

"use client";

import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PricePoint } from "@/lib/operator-journal";

export type ChartDecision = {
  ts: number;
  price: number;
  dir: "up" | "down" | null;
  abstained: boolean;
};

const INK = "#111111";
const EMERALD = "#10B981";
const RED = "#EF4444";
const AMBER = "#F59E0B";

function markerColor(d: ChartDecision): string {
  if (d.abstained || !d.dir) return AMBER;
  return d.dir === "up" ? EMERALD : RED;
}

type TooltipEntry = { payload?: PricePoint };
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const t = new Date(p.ts);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return (
    <div className="border border-line bg-bg-elev px-2.5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <p className="font-mono text-[10px] tabular-nums text-ink">
        ${p.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </p>
      <p className="font-mono text-[9px] text-muted">
        {hh}:{mm}
      </p>
    </div>
  );
}

export default function OperatorChart({
  points,
  strikeUsd,
  decisions,
  height = 160,
}: {
  points: PricePoint[];
  strikeUsd: number | null;
  decisions: ChartDecision[];
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.28em] text-muted"
        style={{ height }}
      >
        price tape warming up…
      </div>
    );
  }

  // Domain that always contains the strike line so it never clips.
  const prices = points.map((p) => p.price);
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (strikeUsd != null) {
    lo = Math.min(lo, strikeUsd);
    hi = Math.max(hi, strikeUsd);
  }
  const pad = (hi - lo) * 0.08 || hi * 0.001;
  const domain: [number, number] = [lo - pad, hi + pad];

  const tMin = points[0]!.ts;
  const tMax = points[points.length - 1]!.ts;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
        <defs>
          <linearGradient id="opPriceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F5F5F5" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#F5F5F5" stopOpacity={0.2} />
          </linearGradient>
        </defs>
        <XAxis dataKey="ts" type="number" domain={[tMin, tMax]} hide />
        <YAxis type="number" domain={domain} hide />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: "#E5E5E5", strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke={INK}
          strokeWidth={1}
          fill="url(#opPriceFill)"
          isAnimationActive={false}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="sma15"
          stroke="#CCCCCC"
          strokeWidth={1}
          strokeDasharray="3 3"
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="sma60"
          stroke="#CCCCCC"
          strokeWidth={1}
          strokeDasharray="1 4"
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        {strikeUsd != null && (
          <ReferenceLine y={strikeUsd} stroke={RED} strokeDasharray="2 4" strokeWidth={1} />
        )}
        {decisions.map((d, i) => (
          <ReferenceDot
            key={`${d.ts}-${i}`}
            x={d.ts}
            y={d.price}
            r={3}
            fill={markerColor(d)}
            stroke="#FFFFFF"
            strokeWidth={1}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
