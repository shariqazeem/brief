// MindEdgeMeter · where the bet comes from. Market-implied Pr(UP)
// (derived live from the SVI surface at the current strike) against
// the agent's own estimate; the visible gap between the two bars IS
// the edge, and the verdict line says whether it cleared the
// threshold or the agent sat out.

"use client";

export function MindEdgeMeter({
  marketP,
  agentP,
  threshold,
  decided,
  direction,
}: {
  /** Market-implied Pr(UP) 0..1 · live from the surface. */
  marketP: number | null;
  /** Agent's estimate 0..1 · from the latest decision. */
  agentP: number | null;
  /** Fire threshold as a fraction (e.g. 0.05). */
  threshold: number;
  /** Whether the latest decision actually placed a bet. */
  decided: boolean;
  direction: "up" | "down" | null;
}) {
  const mp = marketP === null ? null : marketP * 100;
  const ap = agentP === null ? null : agentP * 100;
  const edge = mp !== null && ap !== null ? ap - mp : null;
  const isUp = edge !== null ? edge > 0 : direction === "up";
  const cleared = edge !== null && Math.abs(edge) >= threshold * 100;

  const barW = (v: number) => `${Math.max(8, Math.min(95, v))}%`;

  return (
    <div className="border-2 border-ink bg-bg-elev px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          The edge · market vs agent
        </p>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
          fires when |edge| ≥ {(threshold * 100).toFixed(1)}%
        </p>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <div className="flex items-baseline justify-between font-mono text-[10px] tracking-[0.04em] text-muted">
            <span className="uppercase tracking-[0.2em]">Market says</span>
            <span className="tabular-nums text-ink">
              {mp === null ? "-" : `${mp.toFixed(1)}% UP`}
            </span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden border border-line bg-bg-elev-2/40">
            {mp !== null && (
              <span
                className="block h-full bg-ink/70 transition-[width] duration-700 ease-out"
                style={{ width: barW(mp) }}
              />
            )}
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between font-mono text-[10px] tracking-[0.04em] text-muted">
            <span className="uppercase tracking-[0.2em]">Agent estimates</span>
            <span
              className={
                ap === null
                  ? "tabular-nums text-muted"
                  : isUp
                    ? "tabular-nums text-emerald-800"
                    : "tabular-nums text-red-800"
              }
            >
              {ap === null ? "awaiting decision" : `${ap.toFixed(1)}% UP`}
            </span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden border border-line bg-bg-elev-2/40">
            {ap !== null && (
              <span
                className={`block h-full transition-[width] duration-700 ease-out ${
                  isUp ? "bg-emerald-600" : "bg-red-600"
                }`}
                style={{ width: barW(ap) }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {edge === null ? (
          <p className="font-sans text-[16px] leading-snug text-muted">
            {mp === null
              ? "Reading the surface…"
              : "Market priced · the agent's estimate lands on its next decision."}
          </p>
        ) : (
          <p
            className={`font-sans text-[17px] leading-snug ${
              decided && cleared
                ? isUp
                  ? "text-emerald-800"
                  : "text-red-800"
                : "text-ink-2"
            }`}
          >
            Edge {edge >= 0 ? "+" : "−"}
            {Math.abs(edge).toFixed(1)}%{" "}
            {decided && cleared ? (
              <>
                → bet{" "}
                <strong className="font-semibold">
                  {isUp ? "UP" : "DOWN"}
                </strong>
              </>
            ) : (
              <>→ under threshold · sat out, honestly</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
