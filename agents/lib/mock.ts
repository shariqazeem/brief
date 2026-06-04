// Mock data for dev/CI runs without an LLM. These responses are
// structurally valid per the agent schemas in research/index.ts and
// strategy/index.ts. The shapes match what Anthropic Sonnet/Haiku would
// return, so we exercise the same parsing and on-chain mint paths.

export type MockResearchKind = "research";
export type MockStrategyKind = "strategy";

export function mockResearchJson(topic: string): string {
  const data = {
    topic,
    evaluated: [
      {
        protocol: "NAVI",
        apy: 6.8,
        tvl_usd: 184_000_000,
        audit_status: "audited",
        age_days: 612,
        risk: "low",
      },
      {
        protocol: "Scallop",
        apy: 5.9,
        tvl_usd: 122_000_000,
        audit_status: "audited",
        age_days: 581,
        risk: "low",
      },
      {
        protocol: "Suilend",
        apy: 7.4,
        tvl_usd: 86_000_000,
        audit_status: "partial",
        age_days: 198,
        risk: "medium",
      },
      {
        protocol: "Cetus",
        apy: 11.2,
        tvl_usd: 67_000_000,
        audit_status: "audited",
        age_days: 712,
        risk: "medium",
      },
      {
        protocol: "Bluefin",
        apy: 9.1,
        tvl_usd: 41_000_000,
        audit_status: "audited",
        age_days: 462,
        risk: "medium",
      },
    ],
    top_pick: { protocol: "NAVI", apy: 6.8, confidence: 0.81 },
  };
  return JSON.stringify(data);
}

export function mockStrategyJson(): string {
  const data = {
    allocation: { NAVI: 0.6, Scallop: 0.3, reserve: 0.1 },
    projected_30d_yield: 0.0517,
    ptb_intent: {
      operations: [
        { op: "deposit", protocol: "NAVI", amount_pct: 60 },
        { op: "deposit", protocol: "Scallop", amount_pct: 30 },
      ],
    },
    guardian_warnings: [
      {
        kind: "slippage",
        severity: "amber",
        message:
          "Projected slippage on the NAVI deposit at this size is ~0.34%. Consider splitting the deposit across two transactions.",
      },
    ],
    reasoning:
      "NAVI offers the best risk-adjusted yield in the audited tier, with the highest TVL providing depth. Scallop is the secondary allocation for diversification. A 10% reserve preserves agility for re-rebalancing.",
  };
  return JSON.stringify(data);
}
