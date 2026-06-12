// MindRSIGauge — the contrarian's compass. A horizontal 0–100 rail
// with the oversold/overbought zones shaded the way the strategies
// read them; the needle eases to each new reading so the user can
// watch momentum build toward a fade signal.

"use client";

export function MindRSIGauge({ rsi }: { rsi: number | null }) {
  const zone =
    rsi === null
      ? null
      : rsi > 70
        ? ("overbought" as const)
        : rsi < 30
          ? ("oversold" as const)
          : ("neutral" as const);
  const zoneLabel =
    zone === null
      ? "warming up"
      : zone === "overbought"
        ? "overbought · fade-down zone"
        : zone === "oversold"
          ? "oversold · fade-up zone"
          : "neutral";
  const valueColor =
    zone === "overbought"
      ? "text-red-700"
      : zone === "oversold"
        ? "text-emerald-700"
        : "text-ink";

  return (
    <div className="flex h-full flex-col justify-between border border-line bg-bg-elev px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          RSI · 60m
        </p>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
          {zoneLabel}
        </p>
      </div>

      <p
        key={rsi === null ? "na" : Math.round(rsi)}
        className={`mt-2 font-sans text-[40px] font-medium leading-none tabular-nums tracking-tighter ${valueColor} animate-value-tick`}
      >
        {rsi === null ? "—" : rsi.toFixed(1)}
      </p>

      <div className="mt-4">
        <div className="relative h-3 w-full overflow-hidden border border-line">
          {/* zones: 0–30 oversold (emerald), 30–70 neutral, 70–100 overbought (red) */}
          <span className="absolute inset-y-0 left-0 w-[30%] bg-emerald-100/80" aria-hidden />
          <span className="absolute inset-y-0 left-[30%] w-[40%] bg-bg-elev-2" aria-hidden />
          <span className="absolute inset-y-0 left-[70%] w-[30%] bg-red-100/80" aria-hidden />
          {/* needle */}
          {rsi !== null && (
            <span
              className="absolute inset-y-0 w-[2.5px] bg-ink transition-[left] duration-700 ease-out"
              style={{ left: `calc(${Math.max(0, Math.min(100, rsi))}% - 1px)` }}
              aria-hidden
            />
          )}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] tracking-[0.08em] text-muted">
          <span>0</span>
          <span>30</span>
          <span>70</span>
          <span>100</span>
        </div>
      </div>

      <p className="mt-3 font-mono text-[9.5px] leading-relaxed tracking-[0.04em] text-muted">
        &gt;70 reads overextended UP · &lt;30 overextended DOWN. The
        contrarian fades extremes; the conservative refuses to chase them.
      </p>
    </div>
  );
}
