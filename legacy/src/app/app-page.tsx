"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import {
  BRIEF_PACKAGE_ID,
  explorerUrl,
  useOwnedWorkObjects,
} from "@/lib/brief-client";
import {
  BRIEF_OPERATOR_ADDRESS,
  buildRevokeTx,
  policyStatus,
  useOperatorPolicies,
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";
import {
  decodePayload,
  fetchWalrusPayload,
  type DecodedWorkObject,
} from "@/lib/work-object";
import { OperatorCard } from "@/components/operator/OperatorCard";
import { ThesisPanel } from "@/components/operator/ThesisPanel";
import { ActivityStream } from "@/components/operator/ActivityStream";
import {
  PersistentHeader,
  WalletSessionFix,
  isWalletSessionError,
} from "@/components/operator/PersistentHeader";
import {
  BootSweep,
  ChainIntervention,
  RevokeDarken,
} from "@/components/operator/CeremonyOverlays";
import { RevokePendingBanner } from "@/components/operator/RevokePendingBanner";
import { GrantCeremony } from "@/components/operator/GrantCeremony";
import {
  CommandPalette,
  type Command,
} from "@/components/operator/CommandPalette";

// ---------------------------------------------------------------------------
// Drain any pending mission objective stashed by GrantCeremony. Matches by
// name + recency so a rapid-grant doesn't cross-wire objectives. Best-effort:
// failures are silent — the agent falls back to a derived default.
// ---------------------------------------------------------------------------

function drainPendingObjective(head: OperatorPolicyDecoded): void {
  try {
    const raw = sessionStorage.getItem("brief:pending-objective");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      name?: string;
      objective?: string;
      stashed_at_ms?: number;
    };
    if (!parsed.objective || !parsed.name) return;
    if (parsed.name !== head.name) return;
    // Stale-stash guard — 5 min
    if (
      typeof parsed.stashed_at_ms !== "number" ||
      Date.now() - parsed.stashed_at_ms > 5 * 60 * 1000
    ) {
      sessionStorage.removeItem("brief:pending-objective");
      return;
    }
    fetch("/api/objectives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policy_id: head.id,
        objective: parsed.objective,
      }),
    })
      .then(() => sessionStorage.removeItem("brief:pending-objective"))
      .catch(() => {
        // Non-fatal — leave the stash so next mount tries again.
      });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Top-level — owns data fetching, passes down to header + content
// ---------------------------------------------------------------------------

export default function AppPage() {
  const account = useCurrentAccount();
  const owner = account?.address;
  const { policies, loading: policiesLoading } = useOperatorPolicies(owner);
  const { items: workObjects } = useOwnedWorkObjects(owner);

  // The most recent policy — kept in the console regardless of state, so
  // the user sees the Rejection node land after revoke. Header's revoke
  // button only shows when the policy is still ACTIVE.
  const head = policies[0];
  const headIsLive = head ? policyStatus(head) === "active" : false;
  const liveForHeader = headIsLive ? head : undefined;

  // Ceremony detection — Grant→Live triggers a boot sweep, fresh revoke
  // triggers a darken wash. State transition logic lives in the ref+effect
  // pair below so animations fire exactly once per real on-chain event.
  const prevHeadRef = useRef<{
    id: string | undefined;
    revoked: boolean;
  }>({ id: undefined, revoked: false });
  const [bootSweep, setBootSweep] = useState(false);
  const [revokeDarken, setRevokeDarken] = useState(false);
  const [chainIntervention, setChainIntervention] = useState(false);

  // Track whether we've already fired the chain-intervention beat for the
  // current head policy. Without this guard, the effect re-fires every poll
  // tick because the same Rejection stays in the actions list.
  const interventionFiredForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const prev = prevHeadRef.current;
    const currId = head?.id;
    const currRevoked = head?.revoked ?? false;

    // New operator — and it's freshly minted (avoid firing on initial
    // mount when reloading the page with an existing live operator).
    if (currId && currId !== prev.id) {
      const justCreated =
        head && Date.now() - Number(head.createdAtMs) < 8000;
      if (justCreated && prev.id !== undefined) {
        // Only fire when transitioning from "had a policy" or no policy →
        // brand new policy. Skips first-time mount with stale on-chain data.
        setBootSweep(true);
      } else if (justCreated && prev.id === undefined && policies.length === 1) {
        // First-ever operator from this session — also worth a ceremony.
        setBootSweep(true);
      }

      // Drain any pending mission objective stashed by GrantCeremony. We
      // match by policy name + recency so the right objective lands on the
      // right policy when judges rapid-grant multiple in a row.
      drainPendingObjective(head);
    }

    // Revoke detected — same policy, revoked flipped false → true.
    if (currId && prev.id === currId && !prev.revoked && currRevoked) {
      setRevokeDarken(true);
    }

    prevHeadRef.current = { id: currId, revoked: currRevoked };
  }, [head, policies.length]);

  const headerLatestAction = useMemo(() => {
    if (!liveForHeader) return undefined;
    return workObjects
      .filter(
        (w) =>
          (w.kind === "Operator" || w.kind === "Rejection") &&
          w.parentIds.includes(liveForHeader.id),
      )
      .sort((a, b) => Number(b.timestampMs - a.timestampMs))[0];
  }, [workObjects, liveForHeader]);

  // Chain Intervention — fires once when a fresh Rejection appears for the
  // current head policy. Fresh = mounted within the last 6 seconds (skips
  // historical rejections from policies the user re-encounters on reload).
  useEffect(() => {
    if (!head) return;
    if (interventionFiredForRef.current === head.id) return;
    const rejection = workObjects
      .filter((w) => w.kind === "Rejection" && w.parentIds.includes(head.id))
      .sort((a, b) => Number(b.timestampMs - a.timestampMs))[0];
    if (!rejection) return;
    const ageMs = Date.now() - Number(rejection.timestampMs);
    if (ageMs > 6_000) {
      interventionFiredForRef.current = head.id; // mark old ones as already-acknowledged
      return;
    }
    interventionFiredForRef.current = head.id;
    setChainIntervention(true);
  }, [head, workObjects]);

  // Command Palette actions — context-aware. Built from the same head /
  // policies state the dashboard sees so palette and UI stay coherent.
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (liveForHeader) {
      list.push({
        id: "revoke",
        label: `Revoke ${liveForHeader.name}`,
        hint: "kill switch",
        keywords: ["revoke", "kill", "stop", "abort"],
        destructive: true,
        perform: () => window.dispatchEvent(new CustomEvent("brief:revoke")),
      });
    }
    if (head) {
      list.push({
        id: "policy-suiscan",
        label: "View policy on Sui",
        hint: "suiscan ↗",
        keywords: ["policy", "suiscan", "explorer", "view", "chain"],
        perform: () =>
          window.open(
            `https://suiscan.xyz/testnet/object/${head.id}`,
            "_blank",
            "noopener,noreferrer",
          ),
      });
      list.push({
        id: "owner-suiscan",
        label: "View owner address on Sui",
        hint: "suiscan ↗",
        keywords: ["owner", "address", "wallet", "view"],
        perform: () =>
          window.open(
            `https://suiscan.xyz/testnet/account/${head.owner}`,
            "_blank",
            "noopener,noreferrer",
          ),
      });
    }
    if (!liveForHeader) {
      list.push({
        id: "grant",
        label: "Grant a new operator",
        hint: "ceremony",
        keywords: ["grant", "new", "create", "activate", "operator"],
        perform: () => {
          // Scrolls to the grant ceremony if it's already on the page; the
          // ceremony component handles its own focus on mount.
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
      });
    }
    list.push({
      id: "home",
      label: "Open landing page",
      hint: "↗",
      keywords: ["home", "landing", "marketing", "back"],
      perform: () => {
        window.location.assign("/");
      },
    });
    return list;
  }, [head, liveForHeader]);

  return (
    <main className="min-h-screen bg-bg">
      <PersistentHeader
        liveOperator={liveForHeader}
        latestAction={headerLatestAction}
      />
      <Body
        owner={owner}
        policies={policies}
        workObjects={workObjects}
        loading={policiesLoading}
      />
      <CommandPalette commands={commands} />
      {bootSweep ? <BootSweep onDone={() => setBootSweep(false)} /> : null}
      {revokeDarken ? (
        <RevokeDarken onDone={() => setRevokeDarken(false)} />
      ) : null}
      {chainIntervention ? (
        <ChainIntervention onDone={() => setChainIntervention(false)} />
      ) : null}
    </main>
  );
}

function Body({
  owner,
  policies,
  workObjects,
  loading,
}: {
  owner: string | undefined;
  policies: OperatorPolicyDecoded[];
  workObjects: DecodedWorkObject[];
  loading: boolean;
}) {
  if (!owner) return <ConnectGate />;
  if (BRIEF_PACKAGE_ID === "0x0") return <NotPublishedGate />;

  if (loading && policies.length === 0) {
    return (
      <section className="mx-auto max-w-page px-6 py-24 text-center sm:px-10">
        <Loader2
          className="mx-auto h-5 w-5 animate-spin text-muted"
          strokeWidth={1.75}
        />
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          reading testnet
        </p>
      </section>
    );
  }

  // Route by the most recent ACTIVE policy. Terminal policies (revoked
  // / expired / exhausted) are NEVER the primary view — they live as
  // tombstones inside the GrantFlow archive panel. The user always
  // lands on either a live console or a clean grant form.
  const liveOperators = policies
    .filter((p) => policyStatus(p) === "active")
    .sort((a, b) => Number(b.createdAtMs - a.createdAtMs));
  const archived = policies
    .filter((p) => policyStatus(p) !== "active")
    .sort((a, b) => Number(b.createdAtMs - a.createdAtMs));

  if (liveOperators.length > 0) {
    return (
      <OperatorConsole
        owner={owner}
        liveOperators={liveOperators}
        archived={archived}
        workObjects={workObjects}
      />
    );
  }

  return (
    <GrantFlow
      owner={owner}
      archived={archived}
      workObjects={workObjects}
    />
  );
}

// ---------------------------------------------------------------------------
// Connect gate (unchanged behavior, light copy adjustments)
// ---------------------------------------------------------------------------

function ConnectGate() {
  return (
    <section className="mx-auto flex min-h-[70svh] max-w-page items-center px-6 sm:px-10">
      <div className="mx-auto max-w-2xl text-center animate-fade-up">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Brief · Operator&rsquo;s Console
        </p>
        <h1 className="mt-5 font-sans text-[40px] font-medium italic leading-[1.05] tracking-tight text-ink sm:text-[60px]">
          Connect a wallet.
          <br />
          Insert a charter.
        </h1>
        <p className="mt-5 max-w-prose mx-auto text-[15px] leading-[1.6] text-ink-2">
          Grant a budget to an AI agent. The chain enforces it. Eject
          any time.
        </p>
        <div className="mt-8 flex items-center justify-center">
          <ConnectButton
            connectText="Connect Sui wallet"
            className="!rounded-none"
          />
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          <a
            href={explorerUrl("object", BRIEF_PACKAGE_ID)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            testnet · package live
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
        </p>
      </div>
    </section>
  );
}

function NotPublishedGate() {
  return (
    <section className="mx-auto max-w-page px-6 py-16 sm:px-10">
      <div className="rounded-[14px] border border-dashed border-line-strong p-8">
        <p className="text-[14.5px] text-ink-2">
          Brief Move package not published on this network.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Operator console — LIVE state
// ---------------------------------------------------------------------------

function OperatorConsole({
  owner,
  liveOperators,
  archived,
  workObjects,
}: {
  owner: string;
  liveOperators: OperatorPolicyDecoded[];
  archived: OperatorPolicyDecoded[];
  workObjects: DecodedWorkObject[];
}) {
  const [viewMode, setViewMode] = useState<"console" | "grant-new">("console");
  // Selected policy index — defaults to the most recent (index 0). When
  // a new policy is minted, the live list re-orders and useEffect below
  // snaps the selection back to index 0 (= the freshest).
  const [selectedIdx, setSelectedIdx] = useState(0);
  const safeIdx = Math.min(selectedIdx, liveOperators.length - 1);
  const head = liveOperators[safeIdx]!;

  // When a fresh policy lands (head.id changes), exit grant-new view and
  // snap selection to the new policy.
  const lastTopIdRef = useRef(liveOperators[0]?.id);
  useEffect(() => {
    const topId = liveOperators[0]?.id;
    if (!topId || topId === lastTopIdRef.current) return;
    lastTopIdRef.current = topId;
    setSelectedIdx(0);
    setViewMode("console");
  }, [liveOperators]);

  const actions = useMemo(
    () =>
      workObjects
        .filter(
          (w) =>
            (w.kind === "Operator" || w.kind === "Rejection") &&
            w.parentIds.includes(head.id),
        )
        .sort((a, b) => Number(b.timestampMs - a.timestampMs)),
    [workObjects, head.id],
  );
  const payloads = useDecodedPayloads<OperatorActionPayload>(actions);

  // ALL hooks must be called before any early returns — the held-for-gas
  // detection uses useEffect/useState internally, so it has to run on
  // every render, including the grant-new branch.
  const latestPayload = actions[0] ? payloads.get(actions[0].id) ?? null : null;
  const heldForGas = useIsAgentHeldForGas(latestPayload);

  // Grant-new view: a clean, full-page slot for the ceremony. Once the
  // freshly-minted policy lands on chain and becomes head, the useEffect
  // above pops us back to the console automatically.
  if (viewMode === "grant-new") {
    return (
      <section className="mx-auto flex max-w-page flex-col gap-6 px-6 py-10 sm:px-10 sm:py-12">
        <button
          type="button"
          onClick={() => setViewMode("console")}
          className="inline-flex items-baseline gap-2 self-start text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
        >
          <span aria-hidden>←</span>
          Back to console
        </button>
        <GrantCeremony owner={owner} />
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-6 px-6 py-10 sm:px-10 sm:py-12">
      <ConsoleHeader
        owner={owner}
        liveOperators={liveOperators}
        selectedIdx={safeIdx}
        onSelect={setSelectedIdx}
        onGrantNew={() => setViewMode("grant-new")}
      />

      {/* When held-for-gas, the topup banner is THE primary surface.
          The certificate below is still rendered for context but the
          user's immediate action is in the banner. */}
      {heldForGas ? (
        <HeldForGasBanner payload={latestPayload!} actions={actions} />
      ) : null}

      <OperatorCard policy={head} actions={actions} />
      <ThesisPanel policy={head} workObjects={workObjects} />
      <StakeAccrualPanel />
      <RevokePendingBanner policy={head} actions={actions} />

      {/* The drain-attempt strip — visible only when the operator is
          actually capable of executing (not held for gas / not terminal).
          Lets the user prove the kill switch is real in 5 seconds. */}
      {!heldForGas ? <DrainAttemptStrip policyId={head.id} /> : null}

      <ActivityStream policy={head} actions={actions} payloads={payloads} />

      {/* The eject button — always visible at the bottom of the live
          console. The user's final decisive action: pull the charter
          card out, revoke the operator's authority on chain. */}
      <EjectStrip policy={head} />

      {archived.length > 0 ? (
        <ArchivePanel archived={archived} workObjects={workObjects} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// EjectStrip — the inline revoke. Always visible at the bottom of the
// live console. Two-step (button → confirm) so a stray click doesn't
// kill the operator; once confirmed, signs the revoke tx and lets the
// existing pending-banner / chain-intervention ceremony play out.
// ---------------------------------------------------------------------------

function EjectStrip({ policy }: { policy: OperatorPolicyDecoded }) {
  const [phase, setPhase] = useState<"idle" | "confirm">("idle");
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [error, setError] = useState<string | null>(null);

  const eject = () => {
    setError(null);
    const tx = buildRevokeTx({
      packageId: BRIEF_PACKAGE_ID,
      policyId: policy.id,
    });
    signAndExecute(
      { transaction: tx },
      {
        onError: (e) => setError(e.message),
        onSuccess: () => setPhase("idle"),
      },
    );
  };

  if (phase === "confirm") {
    return (
      <aside className="rounded-2xl border border-red-200 bg-red-50 p-5 sm:p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-red-700">
          Confirm · this revokes the charter on chain
        </p>
        <p className="mt-2 max-w-prose text-[14px] leading-[1.55] text-red-900">
          One signature flips{" "}
          <code className="font-mono text-[13px] text-red-900">
            policy.revoked = true
          </code>{" "}
          on Sui. The agent&rsquo;s next attempted spend aborts with{" "}
          <span className="font-mono">EPolicyRevoked [Code 3]</span> within
          ~15 s. Past actions remain on chain forever as audit trail.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={eject}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Signing…" : "Yes, eject"}
            {!isPending ? <span aria-hidden>⏏</span> : null}
          </button>
          <button
            type="button"
            onClick={() => setPhase("idle")}
            disabled={isPending}
            className="inline-flex items-center rounded-full border border-line-strong px-5 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-bg-elev-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          {error ? (
            <p className="text-[12px] text-red-700">{error.slice(0, 200)}</p>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg-elev px-5 py-4">
      <p className="text-[13px] text-ink-2">
        Done with this operator?
      </p>
      <button
        type="button"
        onClick={() => setPhase("confirm")}
        className="inline-flex items-center gap-2 rounded-full border border-red-200 px-4 py-2 text-[12.5px] font-medium text-red-600 transition-colors hover:bg-red-50"
      >
        Eject operator
        <span aria-hidden>⏏</span>
      </button>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// StakeAccrualPanel — real validator staking yield, on chain.
// Polls `getStakes({ owner: agent })` every 30 s; sums principal + the
// projected rewards Sui RPC returns. When the agent has zero stakes
// (e.g. the operator has only been doing DeepBook orders), the panel
// renders nothing — no fake numbers.
// ---------------------------------------------------------------------------

type DelegatedStakeLite = {
  validatorAddress: string;
  stakingPool: string;
  stakes: Array<{
    stakedSuiId: string;
    principal: string;
    status: "Pending" | "Active" | "Unstaked";
    estimatedReward?: string;
  }>;
};

function StakeAccrualPanel() {
  const client = useSuiClient();
  const [stakes, setStakes] = useState<DelegatedStakeLite[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await client.getStakes({ owner: BRIEF_OPERATOR_ADDRESS });
        if (!cancelled) setStakes(resp as unknown as DelegatedStakeLite[]);
      } catch {
        // RPC throttle / network — keep the previous value
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  if (!stakes || stakes.length === 0) return null;

  let totalPrincipalMist = 0n;
  let totalRewardMist = 0n;
  let activeCount = 0;
  let pendingCount = 0;
  for (const ds of stakes) {
    for (const s of ds.stakes) {
      const principal = BigInt(s.principal ?? "0");
      totalPrincipalMist += principal;
      if (s.estimatedReward) totalRewardMist += BigInt(s.estimatedReward);
      if (s.status === "Active") activeCount++;
      else if (s.status === "Pending") pendingCount++;
    }
  }
  if (totalPrincipalMist === 0n) return null;

  const principalSui = (Number(totalPrincipalMist) / 1e9).toFixed(4);
  const rewardSui = (Number(totalRewardMist) / 1e9).toFixed(6);
  const yieldPct =
    totalPrincipalMist > 0n
      ? ((Number(totalRewardMist) / Number(totalPrincipalMist)) * 100).toFixed(3)
      : "0";

  return (
    <aside className="rounded-2xl border border-line bg-bg-elev p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">
          Live validator stake
        </p>
        <p className="text-[11.5px] tabular-nums text-muted">
          {activeCount > 0 ? `${activeCount} active` : ""}
          {pendingCount > 0
            ? `${activeCount > 0 ? " · " : ""}${pendingCount} pending`
            : ""}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
        <Stat label="Principal staked" value={principalSui} unit="SUI" />
        <Stat
          label="Accrued rewards"
          value={rewardSui}
          unit="SUI"
          tone="pos"
        />
        <Stat
          label="Yield to date"
          value={`+${yieldPct}`}
          unit="%"
          tone="pos"
        />
      </div>
      <p className="mt-4 text-[12px] leading-[1.55] text-muted">
        Live via{" "}
        <code className="font-mono text-[11.5px] text-ink-2">
          SuiClient.getStakes
        </code>
        . Rewards compound each epoch.
      </p>
    </aside>
  );
}

function Stat({
  label,
  value,
  unit,
  tone = "ink",
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "ink" | "pos";
}) {
  const valueClass = tone === "pos" ? "text-emerald-600" : "text-ink";
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 font-mono text-[22px] font-medium tabular-nums leading-none">
        <span className={valueClass}>{value}</span>{" "}
        <span className="text-[12px] font-normal text-muted">{unit}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DrainAttemptStrip — a one-click on-chain test of the chain-enforcement
// guarantee. The user submits a `record_spend` call from THEIR wallet.
// Because the user isn't the bound agent, the chain aborts with
// ENotAgent (code 2) within ~3 s and the rejection lands in the ledger.
// The user only pays a tiny gas fee (~0.001 SUI) for the failed tx.
//
// This is the "test the kill switch" beat — proof, not narrative.
// ---------------------------------------------------------------------------

function DrainAttemptStrip({ policyId }: { policyId: string }) {
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [outcome, setOutcome] = useState<
    | { kind: "idle" }
    | { kind: "success"; digest: string; abortCode: number | null; abortName: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const attempt = () => {
    setOutcome({ kind: "idle" });
    const tx = new Transaction();
    tx.moveCall({
      target: `${BRIEF_PACKAGE_ID}::operator_policy::record_spend`,
      arguments: [
        tx.object(policyId),
        tx.pure.u64(1_000_000n), // arbitrary amount — never moves; the chain aborts first
        tx.pure.string("DrainAttempt"),
        tx.object("0x6"), // sui::clock::Clock
      ],
    });
    signAndExecute(
      { transaction: tx },
      {
        onSuccess: (result) => {
          // Sui returns a successful response shape, but the EFFECTS
          // contain the actual abort. We still treat this as a "demo
          // succeeded" — the abort IS the demo.
          const { code, name } = parseAbort(JSON.stringify(result));
          setOutcome({
            kind: "success",
            digest: result.digest,
            abortCode: code,
            abortName: name,
          });
        },
        onError: (err) => {
          // The wallet adapter often surfaces the abort here. Parse it.
          const msg = err.message ?? String(err);
          const { code, name } = parseAbort(msg);
          if (code !== null) {
            setOutcome({
              kind: "success",
              digest: "", // not in the error path; suiscan link omitted
              abortCode: code,
              abortName: name,
            });
          } else {
            setOutcome({ kind: "error", message: msg });
          }
        },
      },
    );
  };

  return (
    <aside className="rounded-2xl border border-line bg-bg-elev p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">
          Test the kill switch
        </p>
        <p className="text-[11.5px] text-muted">
          one signature · ~0.001 SUI gas
        </p>
      </div>
      <h3 className="mt-2 max-w-prose text-[14px] leading-[1.55] text-ink-2 sm:text-[15px]">
        Try to drain this operator from your own wallet. The chain refuses
        because you&rsquo;re not the bound agent — the rejection lands in
        the ledger as on-chain proof.
      </h3>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={attempt}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-full border border-red-200 px-5 py-2.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? "Submitting…" : "Try to drain this operator"}
        </button>
        {outcome.kind === "success" ? (
          <p className="text-[12.5px] text-red-700">
            <span className="font-medium">Chain refused</span> ·{" "}
            <span className="font-mono">
              {outcome.abortName} [Code {outcome.abortCode ?? "—"}]
            </span>
            {outcome.digest ? (
              <>
                {" · "}
                <a
                  href={explorerUrl("txblock", outcome.digest)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  view tx ↗
                </a>
              </>
            ) : null}
          </p>
        ) : outcome.kind === "error" ? (
          <p className="text-[12.5px] text-muted">
            {outcome.message.slice(0, 200)}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function parseAbort(text: string): { code: number | null; name: string } {
  const KNOWN: Record<number, string> = {
    1: "ENotOwner",
    2: "ENotAgent",
    3: "EPolicyRevoked",
    4: "EPolicyExpired",
    5: "EBudgetExceeded",
    6: "EVenueNotAllowed",
    7: "EInvalidConfig",
    8: "ECannotShrink",
  };
  const m = text.match(/MoveAbort\([^)]*?,\s*(\d+)\)/i);
  if (m && m[1]) {
    const code = Number(m[1]);
    return { code, name: KNOWN[code] ?? "PolicyAbort" };
  }
  const m2 = text.match(/abort\s+code\s+(\d+)/i);
  if (m2 && m2[1]) {
    const code = Number(m2[1]);
    return { code, name: KNOWN[code] ?? "PolicyAbort" };
  }
  return { code: null, name: "(unknown)" };
}

// ---------------------------------------------------------------------------
// HeldForGasBanner — the priority surface when the agent is paused on
// insufficient SUI. Big, copy-the-address, no scrolling required.
// ---------------------------------------------------------------------------

function HeldForGasBanner({
  payload,
}: {
  payload: OperatorActionPayload;
  actions: DecodedWorkObject[];
}) {
  const client = useSuiClient();
  const [copied, setCopied] = useState(false);
  const [faucetState, setFaucetState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);
  /** Live agent balance polled from chain every 5s. The payload's
   *  `free_mist` is a snapshot from the last agent cycle (up to 15s
   *  stale) — when the user is mid-faucet-drip we want them to see the
   *  balance climb in real time. */
  const [liveFreeMist, setLiveFreeMist] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const b = await client.getBalance({ owner: BRIEF_OPERATOR_ADDRESS });
        if (!cancelled) setLiveFreeMist(BigInt(b.totalBalance));
      } catch {
        // ignore
      }
    };
    poll();
    const id = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  const freeMist = liveFreeMist ?? BigInt(payload.gas_check?.free_mist ?? "0");
  const requiredMist = BigInt(payload.gas_check?.required_mist ?? "0");
  const deficitMist =
    requiredMist > freeMist ? requiredMist - freeMist : 0n;
  const streak = payload.memory_context?.consecutive_gas_shortfalls ?? 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BRIEF_OPERATOR_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const drip = async () => {
    setFaucetState("loading");
    setFaucetMsg(null);
    try {
      const resp = await fetch("/api/agent/faucet", { method: "POST" });
      const data = (await resp.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        message?: string;
      } | null;
      if (resp.ok && data?.ok) {
        setFaucetState("success");
        setFaucetMsg(
          "Faucet sent ~1 SUI. The operator wakes within 15 seconds.",
        );
        return;
      }
      setFaucetState("error");
      if (resp.status === 429 || data?.error === "rate_limited") {
        setFaucetMsg(
          "Public testnet faucet is rate-limited (one drip per IP every ~30 s). Try again in a few seconds or send manually.",
        );
      } else {
        setFaucetMsg(data?.message ?? "Faucet failed. Send SUI manually.");
      }
    } catch (e) {
      setFaucetState("error");
      setFaucetMsg((e as Error)?.message ?? "Faucet failed.");
    }
  };

  return (
    <aside
      role="alert"
      aria-live="polite"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
          Agent paused · needs gas
        </p>
        <p className="font-mono text-[11px] tabular-nums text-amber-700">
          {streak > 0 ? `${streak} cycles held · ` : ""}deficit{" "}
          <span className="font-semibold text-amber-900">
            {(Number(deficitMist) / 1e9).toFixed(3)} SUI
          </span>
        </p>
      </div>

      <h2 className="mt-3 max-w-prose text-[18px] font-semibold leading-[1.4] tracking-tight text-ink sm:text-[20px]">
        Send a little SUI to the agent&rsquo;s own wallet.
      </h2>
      <p className="mt-2 max-w-prose text-[14px] leading-[1.55] text-ink-2">
        The agent runs on a{" "}
        <strong className="font-medium text-ink">separate Sui wallet</strong>{" "}
        from yours — it&rsquo;s the AI&rsquo;s own keypair, server-side. Once
        you top it up, the next scan resumes within 15 s. No re-signing.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={drip}
          disabled={faucetState === "loading"}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {faucetState === "loading"
            ? "Requesting…"
            : faucetState === "success"
              ? "Drip sent"
              : "Drip 1 SUI from faucet"}
          {faucetState !== "loading" && faucetState !== "success" ? (
            <span aria-hidden>→</span>
          ) : faucetState === "success" ? (
            <span aria-hidden>✓</span>
          ) : null}
        </button>
        <p className="text-[12.5px] text-ink-2">
          or send manually from any Sui testnet wallet
        </p>
      </div>

      {faucetMsg ? (
        <p
          className={`mt-3 text-[12.5px] leading-[1.55] ${
            faucetState === "success" ? "text-amber-900" : "text-amber-700"
          }`}
        >
          {faucetMsg}
        </p>
      ) : null}

      <div className="mt-5 rounded-xl border border-amber-200 bg-white p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-amber-700">
          Agent wallet · the AI&rsquo;s own keypair, not yours
        </p>
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2">
          <code className="grow truncate font-mono text-[12px] text-amber-900">
            {BRIEF_OPERATOR_ADDRESS}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center rounded-md border border-amber-300 px-2.5 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100"
          >
            {copied ? "copied" : "copy"}
          </button>
          <a
            href={`https://suiscan.xyz/testnet/account/${BRIEF_OPERATOR_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100"
          >
            Suiscan ↗
          </a>
        </div>
        <p className="mt-2 font-mono text-[11.5px] tabular-nums text-amber-700">
          Live balance{" "}
          <span className="font-semibold text-amber-900">
            {(Number(freeMist) / 1e9).toFixed(4)} SUI
          </span>
          <span className="mx-2 text-amber-400">·</span>
          Needs{" "}
          <span className="font-semibold text-amber-900">
            {(Number(requiredMist) / 1e9).toFixed(4)} SUI
          </span>{" "}
          per cycle
        </p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// ConsoleHeader — tiny chrome line above the console: identity + grant CTA.
// ---------------------------------------------------------------------------

function ConsoleHeader({
  owner,
  liveOperators,
  selectedIdx,
  onSelect,
  onGrantNew,
}: {
  owner: string;
  liveOperators: OperatorPolicyDecoded[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  onGrantNew: () => void;
}) {
  const hasMultiple = liveOperators.length > 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-2">
          <span className="font-medium text-ink">Operator&rsquo;s console</span>
          <span className="mx-2 text-muted-2">·</span>
          <span className="text-muted">owner</span>{" "}
          <span className="font-mono text-[12px] tabular-nums text-ink-2">
            {owner.slice(0, 6)}…{owner.slice(-4)}
          </span>
          {hasMultiple ? (
            <>
              <span className="mx-2 text-muted-2">·</span>
              <span className="text-muted">
                {liveOperators.length} active operators
              </span>
            </>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onGrantNew}
          className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-bg-elev-2 hover:text-ink"
        >
          Grant another
          <span aria-hidden>→</span>
        </button>
      </div>

      {hasMultiple ? (
        <OperatorSelector
          liveOperators={liveOperators}
          selectedIdx={selectedIdx}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperatorSelector — horizontal tabs when the owner has more than one
// active charter. Shows name + budget + status pulse for each.
// ---------------------------------------------------------------------------

function OperatorSelector({
  liveOperators,
  selectedIdx,
  onSelect,
}: {
  liveOperators: OperatorPolicyDecoded[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto pb-1">
      {liveOperators.map((p, i) => {
        const selected = i === selectedIdx;
        const remaining = p.budgetCap - p.spent;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(i)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-left transition-colors ${
              selected
                ? "border-accent bg-accent text-white"
                : "border-line bg-bg-elev text-ink-2 hover:border-line-strong hover:text-ink"
            }`}
          >
            <span className="flex items-baseline gap-2">
              <span className="text-[12.5px] font-medium">{p.name}</span>
              <span
                className={`text-[11px] tabular-nums ${selected ? "text-white/75" : "text-muted"}`}
              >
                {(Number(remaining) / 1e9).toFixed(2)} SUI left
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grant flow — entered when there is no LIVE operator (first-time visitor
// OR all charters are archived). Shows the most recent archived charter as
// a tombstone at the top, plus the rest hidden behind an expander, with
// the grant ceremony as the primary surface.
// ---------------------------------------------------------------------------

function GrantFlow({
  owner,
  archived,
  workObjects,
}: {
  owner: string;
  archived: OperatorPolicyDecoded[];
  workObjects: DecodedWorkObject[];
}) {
  const latestArchived = archived[0];
  const hasArchive = archived.length > 0;

  return (
    <section className="mx-auto max-w-page px-6 py-12 sm:px-10 sm:py-16">
      {hasArchive && latestArchived ? (
        <ArchivedTombstone
          policy={latestArchived}
          workObjects={workObjects}
          rest={archived.slice(1)}
        />
      ) : null}

      <div className="mx-auto mt-8 max-w-3xl text-center sm:mt-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          {hasArchive
            ? "The previous charter is archived. Begin a fresh one."
            : "Brief · Operator's Console"}
        </p>
        <h1 className="mt-4 font-sans text-[36px] font-medium italic leading-[1.05] tracking-tight text-ink sm:text-[52px]">
          {hasArchive ? "Issue a new charter." : "Insert a charter."}
        </h1>
        <p className="mt-4 max-w-prose mx-auto text-[15px] leading-[1.55] text-ink-2">
          Pick a preset, name your operator, sign once. The agent runs
          inside the budget. Eject any time.
        </p>
      </div>

      <div className="mt-8 sm:mt-12">
        <GrantCeremony owner={owner} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ArchivedTombstone — compact "previously here" notice rendered when the
// user lands with no live charter. Three lines + expand-archived link.
// Tap to inspect the closed charter's ledger; never the primary surface.
// ---------------------------------------------------------------------------

function ArchivedTombstone({
  policy,
  workObjects,
  rest,
}: {
  policy: OperatorPolicyDecoded;
  workObjects: DecodedWorkObject[];
  rest: OperatorPolicyDecoded[];
}) {
  const [open, setOpen] = useState(false);

  const status = policyStatus(policy);
  const statusLabel =
    status === "revoked"
      ? "revoked"
      : status === "expired"
        ? "expired"
        : status === "exhausted"
          ? "exhausted"
          : "closed";

  const actions = useMemo(
    () =>
      workObjects
        .filter(
          (w) =>
            (w.kind === "Operator" || w.kind === "Rejection") &&
            w.parentIds.includes(policy.id),
        )
        .sort((a, b) => Number(b.timestampMs - a.timestampMs)),
    [workObjects, policy.id],
  );
  const payloads = useDecodedPayloads<OperatorActionPayload>(actions);

  const totalActions = actions.filter((a) => a.kind === "Operator").length;
  const closedAt = formatTimeAgo(policy.createdAtMs); // best-effort — we don't have a precise closed-at on the struct

  return (
    <aside
      className={`border border-line bg-bg-elev ${
        status === "revoked" ? "border-l-2 border-l-red-700" : "border-l-2 border-l-line-strong"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-4 px-5 py-4 text-left transition-colors hover:bg-bg sm:px-6"
        aria-expanded={open}
      >
        <span className="font-mono text-[9.5px] uppercase tracking-[0.36em] text-muted">
          Archived
        </span>
        <span className="min-w-0">
          <span className="text-[14.5px] font-medium text-ink">
            {policy.name}
          </span>
          <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            · {statusLabel} · {totalActions} actions · granted {closedAt}
          </span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {open ? "hide ▴" : "inspect ▾"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-5 py-5 sm:px-6 sm:py-6">
          <RevokePendingBanner policy={policy} actions={actions} />
          <div className="mt-5">
            <ActivityStream
              policy={policy}
              actions={actions}
              payloads={payloads}
            />
          </div>
          {rest.length > 0 ? (
            <details className="mt-6 border-t border-line pt-4">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.32em] text-muted transition-colors hover:text-ink">
                {rest.length} earlier charter{rest.length === 1 ? "" : "s"} ▾
              </summary>
              <ul className="mt-3 divide-y divide-line">
                {rest.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2 font-mono text-[11px] text-ink-2"
                  >
                    <span className="text-ink">{p.name}</span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-muted">
                      {policyStatus(p)} · {formatTimeAgo(p.createdAtMs)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// ArchivePanel — collapsed link at the bottom of the live console giving
// access to closed charters without crowding the primary view.
// ---------------------------------------------------------------------------

function ArchivePanel({
  archived,
  workObjects,
}: {
  archived: OperatorPolicyDecoded[];
  workObjects: DecodedWorkObject[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line pt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted transition-colors hover:text-ink"
        aria-expanded={open}
      >
        {archived.length} closed charter{archived.length === 1 ? "" : "s"}{" "}
        {open ? "▴" : "▾"}
      </button>
      {open ? (
        <div className="mt-4 flex flex-col gap-4">
          {archived.map((p) => (
            <ArchivedTombstone
              key={p.id}
              policy={p}
              workObjects={workObjects}
              rest={[]}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Live held-for-gas detection. The banner is shown only when:
 *   - the latest WorkObject was a held-for-gas mint, AND
 *   - the live agent balance is still below the required-per-cycle.
 *
 * Both conditions must hold. The agent mints exactly one hold WO per
 * streak, so the latest WO can persist after the user tops up; before
 * this hook the banner stayed lit even with 2+ SUI in the wallet.
 */
function useIsAgentHeldForGas(latestPayload: OperatorActionPayload | null): boolean {
  const client = useSuiClient();
  const [liveFreeMist, setLiveFreeMist] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const b = await client.getBalance({ owner: BRIEF_OPERATOR_ADDRESS });
        if (!cancelled) setLiveFreeMist(BigInt(b.totalBalance));
      } catch {
        // ignore — keep the last known value
      }
    };
    poll();
    const id = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  if (latestPayload?.status !== "awaiting_gas_funding") return false;
  const requiredMist = BigInt(latestPayload.gas_check?.required_mist ?? "0");
  if (requiredMist === 0n) return false;
  if (liveFreeMist === null) return true; // still loading — assume held to err safe
  return liveFreeMist < requiredMist;
}

function formatTimeAgo(ms: bigint): string {
  const diff = Date.now() - Number(ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// (Legacy CreateOperator + Field components removed — replaced by the
// 3-stage GrantCeremony component in components/operator/GrantCeremony.tsx.)

// ---------------------------------------------------------------------------
// Shared decoded-payload hook (used by ActivityStream + Drawers via prop)
// ---------------------------------------------------------------------------

type OperatorActionPayload = {
  operator_policy?: string;
  venue?: string;
  amount_mist?: string;
  rationale?: string;
  expected_yield_bps?: number;
  mode?: string;
  fill?: {
    pool?: string;
    side_in?: string;
    side_out?: string;
    amount_in?: string;
    amount_out?: string;
    price?: number;
  };
  reason?: string;
  error?: string;
  attempted_at_ms?: number;
  status?: "deployed" | "awaiting_gas_funding";
  execution_mode?: "deepbook" | "stake";
  gas_check?: {
    free_mist?: string;
    required_mist?: string;
    deficit_mist?: string;
    headroom_mist?: string;
    checked_at_ms?: number;
  };
  gas_shortage_mist?: string;
  memory_context?: {
    consecutive_gas_shortfalls?: number;
    posture?: string;
  };
};

function useDecodedPayloads<T = unknown>(
  objs: DecodedWorkObject[],
): Map<string, T> {
  const [map, setMap] = useState<Map<string, T>>(new Map());
  const idsKey = objs.map((o) => o.id).join("|");

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, T>();

    for (const o of objs) {
      if (o.payloadBytes && o.payloadBytes.length > 0) {
        try {
          next.set(o.id, decodePayload<T>(o.payloadBytes));
        } catch {
          // ignore
        }
      }
    }

    const walrusJobs = objs
      .filter((o) => !next.has(o.id) && !!o.walrusBlobId)
      .map(async (o) => {
        try {
          const p = await fetchWalrusPayload<T>(o.walrusBlobId!);
          if (!cancelled) {
            next.set(o.id, p);
            setMap(new Map(next));
          }
        } catch {
          // ignore
        }
      });

    setMap(next);
    Promise.allSettled(walrusJobs);

    return () => {
      cancelled = true;
    };
  }, [idsKey, objs]);

  return map;
}
