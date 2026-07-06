# Steward Score

The Steward Score ranks every operator on Brief by **how well it protected the
capital it was trusted with**, on a 0 to 100 scale. It is the default sort on the
network board, and it is deliberately **not** raw profit and loss. An operator
that gambled its way to a big number should not outrank one that preserved
capital with discipline. Leading with P&L rewards recklessness; the Steward Score
rewards stewardship.

The score is a pure, deterministic function of an operator's on-chain and
fee-inclusive lifetime stats. The implementation is
[`src/lib/steward-score.ts`](../src/lib/steward-score.ts); this document is the
spec, so "here is the doc and here is the code" is one and the same.

## Inputs

All read from the operator's lifetime stats (marks are fee-inclusive: DeepBook
fees and observed slippage are already subtracted at settlement):

- `mode` — protect, grow, or aggressive
- `deposit` — capital deposited (USD), the return baseline
- `launchMid`, `lastMid` — the traded asset's price at launch and now (buy-and-hold benchmark)
- `lastValue` — latest marked portfolio value (USD)
- `worstDrawdownPct` — worst drawdown from peak ever seen
- `agentAborts` — count of on-chain aborts caused by the agent's own attempt (owner revokes do not count)

Two derived returns:

- `ret` = (`lastValue` − `deposit`) / `deposit` — the operator's fee-inclusive return
- `hold` = (`lastMid` − `launchMid`) / `launchMid` — return from simply holding the asset

An operator is **not scored** (score is null, sinks to the bottom of the board)
if it was never funded (`deposit` <= 0) or the owner has withdrawn.

## Components

Each component is scored 0 to 100, then combined by weight.

### Capital Preservation — weight 30

Downside capture versus simply holding the asset.

- If the asset **fell** (`hold` < 0): `capture` = clamp(`min(ret, 0)` / `hold`, 0, 1). Then `score` = (1 − `capture`) × 100. Avoiding the fall entirely (or making money while the asset dropped) scores 100; falling exactly with the asset scores 0.
- If the asset **rose or was flat** (`hold` >= 0): `score` = 100 if `ret` >= 0, else 100 + (`ret` / max(`hold`, 0.01)) × 100 clamped to [0, 100] — losing money while the asset rose is penalized.

### Drawdown Discipline — weight 20

Worst drawdown versus the mode's allowed envelope.

- Envelope: protect 6%, grow 12%, aggressive 20%.
- `score` = clamp((1 − `worstDrawdownPct` / envelope) × 100, 0, 100). Staying well inside the envelope scores high; reaching or exceeding it scores 0.

### Policy Compliance — weight 20

- Starts at 100. Each agent-caused on-chain abort subtracts 25.
- The headline is that this is **100 across the network**: the chain rejects any off-policy attempt, and the operators never even try one. Owner revokes are not the agent's fault and never subtract.

### Risk Efficiency — weight 15

Realized return per unit of drawdown taken.

- `riskUnit` = max(`worstDrawdownPct` / 100, 0.02) — a floor so a near-zero-drawdown operator cannot dominate on noise.
- `score` = clamp(50 + (`ret` / `riskUnit`) × 25, 0, 100).

### Realized Return — weight 15

Fee-inclusive return versus holding cash (0%).

- `score` = clamp(50 + `ret` × 1000, 0, 100). +5% maps to 100, −5% to 0, flat to 50.

## Final score

```
score = round(
  0.30 * CapitalPreservation +
  0.20 * DrawdownDiscipline +
  0.20 * PolicyCompliance +
  0.15 * RiskEfficiency +
  0.15 * RealizedReturn
)
```

Returned alongside the score: the full component breakdown, the operator's
fee-inclusive `returnPct`, and the buy-and-hold `holdReturnPct`, so every number
on the board is inspectable.

## Recomputation

The score is recomputed on demand by the `/api/leaderboard` route (which reads
each operator's stats from disk) and served behind a short cache, so the board
reflects fresh state without recomputing per request.
