// Tiny client hook for reading the off-chain mission objective for a policy.
// Mirrors the read path the agent uses (objectives.ts), but via the
// /api/objectives route. Polls a couple of times after grant to absorb the
// brief window before the POST lands; then settles on a fixed value.

"use client";

import { useEffect, useState } from "react";

export function useObjective(policyId: string | undefined): {
  objective: string | null;
  loading: boolean;
} {
  const [objective, setObjective] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!policyId) {
      setObjective(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      attempts++;
      try {
        const resp = await fetch(
          `/api/objectives?policy_id=${encodeURIComponent(policyId)}`,
        );
        if (!resp.ok) throw new Error(`http ${resp.status}`);
        const data = (await resp.json()) as {
          objective: string | null;
        };
        if (!cancelled) {
          setObjective(data.objective);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    // For ~30 seconds after first read, poll every 3s to catch the POST
    // from GrantCeremony. After that we accept the answer.
    const handle = setInterval(() => {
      if (attempts > 10) {
        clearInterval(handle);
        return;
      }
      if (objective) {
        clearInterval(handle);
        return;
      }
      tick();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  return { objective, loading };
}
