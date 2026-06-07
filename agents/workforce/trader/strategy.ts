// Trader strategies — deterministic, no LLM in the hot loop. Each
// strategy is a pure function over the indexer's live + historical
// oracles, producing a directional decision (UP or DOWN) and a small
// plain-language reasoning string the agent stores on Walrus.
//
// These are the "personalities" the Phase-3 consumer UI will surface as
// adoptable traders. New strategies plug in by adding a key to STRATEGIES
// and a function below; the trader agent picks them by name.

import type { IndexerOracle } from "../lib/predict.js";

export type Direction = "up" | "down";

export type StrategyId = "conservative" | "momentum" | "contrarian";

export type StrategyInput = {
  /** The active BTC oracle the agent already picked (nearest expiry). */
  oracle: IndexerOracle;
  /** Live spot price for `oracle`, in raw 1e9 units. */
  spotRaw: bigint;
  /** Up to N most-recently-settled BTC oracles, newest first. */
  recentSettled: IndexerOracle[];
  /** Wall-clock now, ms. */
  nowMs: number;
};

export type StrategyDecision = {
  strategy: StrategyId;
  direction: Direction;
  /** Position size in dUSDC contracts (1 contract = $1 nominal). */
  quantity: number;
  /** One-sentence plain English reasoning, suitable for the Narrator. */
  reasoning: string;
};

const STRATEGY_DEFAULT_QUANTITY: Record<StrategyId, number> = {
  conservative: 1,
  momentum: 2,
  contrarian: 2,
};

// === Strategies ===

/** ATM, small quantity, no directional bias. Always picks UP — the
 *  strike is at-the-money so up/down has no edge; the strategy's
 *  signature is keeping the position size tiny. */
function conservative(input: StrategyInput): StrategyDecision {
  return {
    strategy: "conservative",
    direction: "up",
    quantity: STRATEGY_DEFAULT_QUANTITY.conservative,
    reasoning: `Conservative path: ATM strike near $${fmtSpot(input.spotRaw)} on the ${msUntil(input.oracle.expiry, input.nowMs)} BTC market, smallest viable position. No directional edge — we trade for participation, not conviction.`,
  };
}

/** Follow the direction of the last N settled markets — if more closed
 *  above their open spot than below, lean UP; else DOWN. Tie → UP. */
function momentum(input: StrategyInput): StrategyDecision {
  // The indexer doesn't give us per-oracle "opening spot," so we
  // approximate momentum by comparing consecutive settlement prices:
  // each settlement-vs-previous-settlement delta is one vote.
  const votes = countDeltaVotes(input.recentSettled);
  const direction: Direction = votes.up >= votes.down ? "up" : "down";
  return {
    strategy: "momentum",
    direction,
    quantity: STRATEGY_DEFAULT_QUANTITY.momentum,
    reasoning: `Momentum: the last ${votes.up + votes.down} settled BTC bars closed UP ${votes.up} time(s) vs DOWN ${votes.down}. Leaning ${direction.toUpperCase()} on the ${msUntil(input.oracle.expiry, input.nowMs)} market near $${fmtSpot(input.spotRaw)}.`,
  };
}

/** Fade the most-recent settled bar. If it closed UP, bet DOWN; etc.
 *  When no history, defaults DOWN as the differentiator vs conservative. */
function contrarian(input: StrategyInput): StrategyDecision {
  const votes = countDeltaVotes(input.recentSettled.slice(0, 3));
  const lastUp = votes.up > votes.down;
  const direction: Direction = lastUp ? "down" : "up";
  return {
    strategy: "contrarian",
    direction,
    quantity: STRATEGY_DEFAULT_QUANTITY.contrarian,
    reasoning: `Contrarian: the last 3 settled BTC bars went UP ${votes.up} time(s); fading by going ${direction.toUpperCase()} on the ${msUntil(input.oracle.expiry, input.nowMs)} market near $${fmtSpot(input.spotRaw)}.`,
  };
}

// === Registry ===

export const STRATEGIES: Record<
  StrategyId,
  (input: StrategyInput) => StrategyDecision
> = {
  conservative,
  momentum,
  contrarian,
};

export function decide(
  strategy: StrategyId,
  input: StrategyInput,
): StrategyDecision {
  const fn = STRATEGIES[strategy];
  if (!fn) throw new Error(`unknown strategy: ${strategy}`);
  return fn(input);
}

// === Helpers ===

function countDeltaVotes(
  oracles: IndexerOracle[],
): { up: number; down: number } {
  let up = 0;
  let down = 0;
  // oracles are newest-first; compare each to the next (older) one.
  for (let i = 0; i < oracles.length - 1; i++) {
    const cur = oracles[i].settlement_price ?? 0;
    const prev = oracles[i + 1].settlement_price ?? 0;
    if (cur > prev) up++;
    else if (cur < prev) down++;
  }
  return { up, down };
}

function fmtSpot(raw: bigint): string {
  const dollars = Number(raw) / 1_000_000_000;
  return dollars.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function msUntil(expiryMs: number, nowMs: number): string {
  const dt = expiryMs - nowMs;
  if (dt < 0) return "expired";
  const mins = Math.floor(dt / 60_000);
  if (mins < 60) return `${mins}-minute`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}-hour`;
  const days = Math.floor(hours / 24);
  return `${days}-day`;
}
