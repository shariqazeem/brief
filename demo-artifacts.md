# Brief — Day 4 demo artifacts (workforce end-to-end on Sui testnet)

First successful full chain through the **Agent Commerce** loop:
user → Planner → 2 sub-tasks posted with policy-escrowed bounty → Research +
Treasury each accept & deliver → user approves → bounties paid atomically
with `record_spend` against the policy → agent reputation bumped.

All artifacts live on Sui testnet under package
`0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d`.

## Mission

> Evaluate the brief::task Move module for a 50,000 USD DAO grant. Recommend
> approve/reject with reasoning, and probe testnet DeepBook liquidity to
> size disbursement.

## OperatorPolicy

| Field | Value |
|---|---|
| Object id | `0xa854be7c649465a021ebd0a84bd04b2c199932827a52ef7bf42f081b9a8e44f3` |
| Name | Day 4 Demo Workforce |
| Budget cap | 1.000 SUI |
| Allowed venues | `[research, audit, treasury]` |
| Expires | 2 hours after creation |
| Create tx | `ESUdWVdh3ifgZaFkxQzcxZLQjPYnnDcJiXqaYyZJg8eQ` |
| Explorer | https://suiscan.xyz/testnet/object/0xa854be7c649465a021ebd0a84bd04b2c199932827a52ef7bf42f081b9a8e44f3 |

## Sub-tasks posted by the Planner

### 1) Research + Move audit

| Field | Value |
|---|---|
| Task id | `0x0ead64002b615e4172a8bb468bf4f3130dec86a004255eb8db7f51b8b7385434` |
| Capability | research |
| Bounty | 0.15 SUI |
| Assigned to | `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435` |
| Post tx | `HzR4a4fTt8FSBp5MboPtpE1J8sqWRQZEaVbqCxpC2Ub8` |
| Walrus blob | `orNFxS69aCtpvMxh8yPmJEOAKwFXVC_74msjf58X8eI` |
| Walrus URL | https://aggregator.walrus-testnet.walrus.space/v1/blobs/orNFxS69aCtpvMxh8yPmJEOAKwFXVC_74msjf58X8eI |
| Approve tx | `8F1y9hX1LkZCUEKakrqKQrdMEqErRtoaWexmKfLUmeYP` |
| Approve explorer | https://suiscan.xyz/testnet/tx/8F1y9hX1LkZCUEKakrqKQrdMEqErRtoaWexmKfLUmeYP |

### 2) Disbursement sizing + liquidity probe

| Field | Value |
|---|---|
| Task id | `0xf5c09b45b3e3073890180aca3da293e0ce83ac39a4c305b76226358d876fbbe5` |
| Capability | treasury |
| Bounty | 0.15 SUI |
| Assigned to | `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435` |
| Post tx | `57YfeX14xMmcgZZVFx9EiCNvYWSjeB9jxejUfyX4ThNZ` |
| Deliver tx | `7e7fLMXfDM9TP2PpFbmW5rMsiRB8bjKbDNExN9NKV89g` |
| Mode | simulated (wallet below 2.5 SUI live threshold) |
| Mid price used | $2.00 (fallback — DeepBook RPC midPrice unavailable at delivery time) |
| Approve tx | `EGo3wtD7VhQw5gZJUiCajoC2pr16xHhT6PwL5tqwQVMb` |
| Approve explorer | https://suiscan.xyz/testnet/tx/EGo3wtD7VhQw5gZJUiCajoC2pr16xHhT6PwL5tqwQVMb |

## Final on-chain state (verified after both approvals)

| Surface | Field | Value |
|---|---|---|
| Policy | `spent` | `0.3 SUI` (0.15 + 0.15) |
| Policy | `remaining` | `0.7 SUI` of 1.0 budget cap |
| Policy | `revoked` | `false` |
| AgentRegistration | `completed_tasks` | `3` (was 1 before this run) |
| AgentRegistration | `total_paid` | `400_000_000 MIST` (was 100M) |
| AgentRegistration | `reputation_score` | `3` (was 1) |
| Wallet | net delta | `-0.043 SUI` (gas only — bounties paid back to single-wallet operator) |

---

# Kill switch ceremony (2026-06-05) — the killer demo beat

A second, independent end-to-end run to prove the *revocation aborts
payment on chain* story. Identical workforce, fresh policy, one task,
and a deliberate revoke between deliver and approve.

## Policy (revoke-target)

| Field | Value |
|---|---|
| Object id | `0x60eda8e3e77ea54851dc90faaecf6a7e04c4aaf964d69d1d30195b89b2e4defa` |
| Name | Revoke Ceremony Test |
| Budget cap | 0.5 SUI |
| Allowed venues | `[research, audit, treasury]` |
| Create tx | `DHHgAYkRscZEwqSoawCV93shNirjsU5DNzww771BJ3kF` |

## Task posted by Planner

| Field | Value |
|---|---|
| Task id | `0x23a4930aa2e646096e5c96e2ff4c71dbddb77bb6b91a071cecd6191536551f8a` |
| Capability | research |
| Bounty | 0.1 SUI |
| Post tx | `5DxYRorAJQkbussV4jqTpepHdxrj5uunyK8FQ92DFqti` |
| Walrus blob | `orNFxS69aCtpvMxh8yPmJEOAKwFXVC_74msjf58X8eI` (same content as Day 4 — same target package) |

## Sequence on chain

| Step | Action | Result | Tx digest |
|---|---|---|---|
| 1 | Planner posts research sub-task with `parent_policy = 0x60eda8e3…` | Task created, status=OPEN, 0.1 SUI escrowed | `5DxYRorAJQkbussV4jqTpepHdxrj5uunyK8FQ92DFqti` |
| 2 | Research agent accepts | status=ACCEPTED | (in agent log) |
| 3 | Research agent uploads to Walrus (15.5s) + mints Deliverable + submits | status=DELIVERED | `3coEkULwJUZe…` |
| 4 | **Owner revokes the policy** | `policy.revoked = true` on chain | `5f4BHR1Q7sPGT3aZC22uXq38y7zjaM8mnAKspJGTX5Eo` |
| 5 | Owner attempts `task::approve_with_policy` | **ABORTS with `assert_can_spend` → EPolicyRevoked (code 3)** | `HDRPJygY7Q8HoNTLgWDoVRzsSupD3jKKh9NozQsuNU6T` |

## Resolved abort

```
[approve] tx ABORTED on chain — policy enforced
[approve] module    operator_policy
[approve] function  assert_can_spend
[approve] code      3 (EPolicyRevoked)
```

The bounty stayed escrowed in the task (status stays at DELIVERED). The
agent never got paid. The reputation never bumped. The chain — not our
server, not a guardian process, the chain itself — refused settlement
because of the revoke. After the task deadline passes, anyone can call
`task::expire` to return the bounty to the poster.

This is the slide-worthy demo arc:

> 1. Owner grants Planner a 0.5 SUI budget for `[research, audit, treasury]`.
> 2. Planner decomposes a mission, posts an escrowed research sub-task.
> 3. Research agent accepts, audits, delivers (Walrus-backed).
> 4. Owner clicks **REVOKE**.
> 5. Owner tries to approve → chain aborts with **`EPolicyRevoked`**.
>
> *The AI is not trusted. The policy is.*

## What this verifies for judges

- `operator_policy::revoke` works as a one-signature kill switch
- `task::approve_with_policy` is atomic with `record_spend`
- Revocation interleaved between submit and approve genuinely aborts the
  payment, even though the deliverable was already submitted
- The Move abort code surfaces cleanly through our `workforce-approve-task`
  CLI so we can demonstrate the exact rule that fired

## Specialist registrations

| Agent | Address | Registration id | Capabilities |
|---|---|---|---|
| Research + Treasury (single-wallet Wk1) | `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435` | `0xd6a4a09a5893d6e1b7ad2b23b6c6d4866c1ec8441db2b1c5ca433adedf29230c` | `[research, audit, treasury]` |

## Honest caveats

- LLM (DeepSeek v4-flash via Commonstack) was rate-limited at the time of
  recording (`429 — quota exceeded`). Planner and Research both fell back
  to deterministic template mode. The on-chain settlement and the
  workforce orchestration are identical regardless of LLM availability;
  only the deliverable prose changes. To run with full LLM enrichment,
  ensure the Commonstack key has quota or set `ANTHROPIC_API_KEY`.
- Treasury Agent ran in simulated mode because the operator wallet held
  ~0.95 SUI at delivery time — below the `LIVE_MODE_MIN_BALANCE_SUI = 2.5`
  threshold needed to deposit + post two 1 SUI POST_ONLY limit orders on
  the SUI/DBUSDC pool. Top up the wallet to ≥ 5 SUI before the demo video
  recording day (Day 14) to capture live mode.
- Single-wallet mode for Wk1 — Planner, Research, and Treasury share the
  agent wallet (`0xd440b0b5…`). Multi-wallet separation lands with the
  workforce UI on Day 8.
