// Client mirror of the trader's goal calibration.
//
// MUST stay in sync with agents/workforce/trader/strategy.ts
// (`calibrateParams` / `baselineParams`). The two are deterministic, pure
// arithmetic; the client copy lets the adoption wizard preview — and the
// dashboard show — exactly the thresholds the trader will use. The agent
// (a separate build) can't import from src/, hence the small duplication.

import type { StrategyId } from "@/lib/workforce-client";

export type GoalType = "grow" | "preserve" | "edge";

export type OperatorGoal = {
  type: GoalType;
  /** Only meaningful for "grow". */
  targetPct?: number;
  horizonDays?: number;
};

export type CalibratedParams = {
  minEdge: number;
  maxQty: number;
  convictionFloor: number;
};

export function baselineParams(strategy: StrategyId): CalibratedParams {
  return {
    minEdge: 0.05,
    // momentum/contrarian/quant size up to base(2)+2; conservative never upsizes.
    maxQty: strategy === "conservative" ? 1 : 4,
    convictionFloor:
      strategy === "contrarian" || strategy === "quant" ? 0.4 : 0.3,
  };
}

export function calibrateParams(
  strategy: StrategyId,
  goal: OperatorGoal | null | undefined,
): CalibratedParams {
  const base = baselineParams(strategy);
  if (!goal || goal.type === "edge") return base;
  if (goal.type === "preserve") {
    return {
      minEdge: Number((base.minEdge * 1.5).toFixed(3)),
      maxQty: Math.max(base.maxQty - 1, 1),
      convictionFloor: Number((base.convictionFloor * 1.3).toFixed(2)),
    };
  }
  if (goal.type === "grow" && goal.targetPct && goal.horizonDays) {
    const dailyPace = goal.targetPct / goal.horizonDays;
    const urgency = Math.min(dailyPace / 0.17, 1.4); // 0.17%/day ≈ 5%/30d
    return {
      minEdge: Number((base.minEdge * (1.15 - urgency * 0.25)).toFixed(3)),
      maxQty: base.maxQty,
      convictionFloor: Number(
        (base.convictionFloor * (1.05 - urgency * 0.1)).toFixed(2),
      ),
    };
  }
  return base;
}

/** Smart default goal per personality — the user can override. */
export function defaultGoalFor(strategy: StrategyId): OperatorGoal {
  switch (strategy) {
    case "conservative":
      return { type: "preserve" };
    case "momentum":
      return { type: "grow", targetPct: 5, horizonDays: 30 };
    case "contrarian":
    case "quant":
      return { type: "edge" };
  }
}

export function goalLabel(goal: OperatorGoal): string {
  if (goal.type === "preserve") return "Preserve capital";
  if (goal.type === "edge") return "Maximize edge";
  return `Grow ${goal.targetPct ?? "?"}% in ${goal.horizonDays ?? "?"}d`;
}

export const GOAL_HORIZONS = [7, 30, 90] as const;
