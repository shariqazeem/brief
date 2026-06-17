// SystemHealthDot · one honest dot for "can Brief trade right now?".
// Polls /api/system/health (warden status + feed freshness) every 30s.
// Green: everything live. Amber: degraded, with the reason on hover
// and beside the dot · we surface problems, never hide them.

"use client";

import { useEffect, useState } from "react";

import { apiUrl } from "@/lib/api-base";

type Health = {
  healthy: boolean;
  problems: string[];
};

export function SystemHealthDot() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch(apiUrl("/api/system/health"));
        if (r.ok) {
          const j = (await r.json()) as Health;
          if (!cancelled) setHealth({ healthy: j.healthy, problems: j.problems ?? [] });
        }
      } catch {
        /* keep last known state */
      }
      if (!cancelled) timer = setTimeout(tick, 30_000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!health) return null;

  const label = health.healthy
    ? "All systems live"
    : health.problems[0] ?? "degraded";

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted"
      title={health.problems.join(" · ") || "warden, price feed and wallets all green"}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        {health.healthy && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            health.healthy ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
      </span>
      {label}
    </span>
  );
}
