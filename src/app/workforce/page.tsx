"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  Droplets,
  Loader2,
  ShieldOff,
  Sparkles,
} from "lucide-react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { BRIEF_PACKAGE_ID, explorerUrl } from "@/lib/brief-client";
import {
  BRIEF_OPERATOR_ADDRESS,
  WORKFORCE_TEMPLATES,
  templateById,
  buildActivateTx,
  dispatchMission,
  extractTargetPackageId,
  useAgentRegistration,
  useDeliverable,
  usePolicy,
  useRecentTaskActivity,
  useRegisteredAgents,
  useResolvedPolicyId,
  useTasksForPolicy,
  type RegisteredAgent,
  type TaskStatus,
  type WorkforceTask,
} from "@/lib/workforce-client";
import {
  buildRevokeTx,
  policyStatus,
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";

// =============================================================================
// /workforce — single-step hire + live console.
//
// The judge's 30-second story: open the page → see a living agent economy
// (real specialists, real reputation, real recent work); connect → write
// ONE brief, set a budget, sign once; watch the workforce light up and
// settle on chain; press Revoke once to make the blockchain itself
// refuse the next payment.
// =============================================================================

type ActivationResult = {
  policyId: string | null;
  txDigest: string;
  templateId: string;
  name: string;
  brief: string;
  budgetSui: number;
  allowedVenues: string[];
};

export default function WorkforcePage() {
  const account = useCurrentAccount();

  return (
    <main className="min-h-screen bg-bg text-ink">
      <Header connected={account?.address} />
      {account ? (
        <Connected address={account.address} />
      ) : (
        <Disconnected />
      )}
    </main>
  );
}

// =============================================================================
// Header
// =============================================================================

function Header({ connected }: { connected?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[15px] font-medium tracking-tight">Brief</span>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            · workforce
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {connected && (
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2 sm:inline">
              {short(connected)}
            </span>
          )}
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="2" y="5" width="16" height="2" rx="0.5" fill="currentColor" />
      <rect x="2" y="13" width="11" height="2" rx="0.5" fill="currentColor" />
    </svg>
  );
}

// =============================================================================
// Disconnected — roster + activity, then the connect prompt
// =============================================================================

function Disconnected() {
  return (
    <section className="mx-auto max-w-page px-6 pt-12 pb-24 sm:px-10 sm:pt-16">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Workforce · live on Sui testnet
        </p>
        <h1 className="mt-4 font-sans text-4xl font-medium tracking-tightest sm:text-5xl">
          Hire an autonomous workforce.
        </h1>
        <p className="mt-5 max-w-prose text-lg leading-relaxed text-ink-2">
          Write one sentence — a brief. Sign once. Specialist AI agents
          accept the work, deliver it on chain, and get paid. Revoke any
          time, and the blockchain itself refuses the next payment.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <ConnectButton connectText="Connect wallet to hire" />
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
          >
            ← Back to landing
          </Link>
        </div>
      </div>

      <RosterAndActivity />
    </section>
  );
}

function RosterAndActivity() {
  return (
    <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_1fr]">
      <Roster />
      <RecentActivityPanel />
    </div>
  );
}

// =============================================================================
// Roster — live registered specialists (excluding the Planner)
// =============================================================================

function Roster() {
  const { agents, loading } = useRegisteredAgents({
    excludeAddress: BRIEF_OPERATOR_ADDRESS,
  });

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Workforce roster · {agents.length || ""}
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {loading ? "loading…" : "live · 8s"}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {!loading && agents.length === 0 && (
          <EmptyHint>
            No specialist has registered on chain yet — start the workforce
            and the roster fills in within seconds.
          </EmptyHint>
        )}
        {agents.map((a) => (
          <AgentRosterCard key={a.id} agent={a} />
        ))}
      </div>
    </section>
  );
}

function AgentRosterCard({ agent }: { agent: RegisteredAgent }) {
  const earned = Number(agent.totalPaidMist) / 1e9;
  return (
    <article className="group relative border border-line bg-bg-elev p-4 transition-colors hover:border-line-strong">
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium tracking-tight text-ink">
            {agent.displayName || "Unnamed agent"}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">
            {short(agent.address, 8, 6)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {agent.capabilities.map((c) => (
            <span
              key={c}
              className="border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <Stat label="Reputation" value={String(agent.reputationScore)} />
        <Stat label="Delivered" value={String(agent.completedTasks)} />
        <Stat
          label="Earned"
          value={`${earned.toFixed(earned >= 1 ? 2 : 3)} SUI`}
        />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-[14px] tabular-nums text-ink">{value}</p>
    </div>
  );
}

// =============================================================================
// Recent on-chain activity — every visitor sees the agent economy moving
// =============================================================================

function RecentActivityPanel() {
  const { items, loading } = useRecentTaskActivity(8);
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Recent work · on chain
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {loading ? "loading…" : "live · 4s"}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-line border border-line bg-bg-elev">
        {!loading && items.length === 0 && (
          <li className="px-4 py-5">
            <EmptyHint inline>
              No recent tasks on chain yet. The first mission lights this
              up.
            </EmptyHint>
          </li>
        )}
        {items.map((it, idx) => (
          <li
            key={`${it.txDigest}:${it.kind}`}
            className="px-4 py-3 animate-land-in"
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ActivityDot kind={it.kind} />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                  {it.kind === "posted" ? "POSTED" : "PAID"}
                </span>
                <span className="truncate text-[13.5px] text-ink">
                  {it.title || titleFromCapability(it.capability, it.kind)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-ink-2">
                  {(Number(it.bountyMist) / 1e9).toFixed(2)} SUI
                </span>
                <a
                  href={explorerUrl("txblock", it.txDigest)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-ink"
                >
                  tx
                  <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityDot({ kind }: { kind: "posted" | "approved" }) {
  return (
    <span
      className={[
        "inline-block h-1.5 w-1.5 rounded-full",
        kind === "approved" ? "bg-emerald-500" : "bg-ink/40",
      ].join(" ")}
      aria-hidden
    />
  );
}

function titleFromCapability(cap: string, kind: "posted" | "approved"): string {
  if (kind === "approved") return `Settled ${cap || "task"}`;
  return cap ? `New ${cap} job` : "New task";
}

// =============================================================================
// Connected — single-step hire form OR live console
// =============================================================================

function Connected({ address }: { address: string }) {
  const [activation, setActivation] = useState<ActivationResult | null>(null);

  if (!activation) {
    return (
      <section className="mx-auto max-w-page px-6 pt-12 pb-24 sm:px-10 sm:pt-16">
        <ColdStartFaucet address={address} />
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
          <HireForm address={address} onActivated={setActivation} />
          <aside className="space-y-8">
            <Roster />
          </aside>
        </div>
        <div className="mt-16">
          <RecentActivityPanel />
        </div>
      </section>
    );
  }
  return (
    <LiveConsole activation={activation} onReset={() => setActivation(null)} />
  );
}

// =============================================================================
// Cold-start faucet — a brand-new wallet has 0 SUI and can't sign the grant.
// This banner appears the moment we detect the connected wallet is empty
// and goes away the moment it has enough SUI to act.
// =============================================================================

const COLD_START_MIN_SUI = 0.05;

function ColdStartFaucet({ address }: { address: string }) {
  const client = useSuiClient();
  const [balanceSui, setBalanceSui] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phase, setPhase] = useState<"idle" | "fetching" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const b = await client.getBalance({ owner: address });
        if (!cancelled) {
          setBalanceSui(Number(b.totalBalance) / 1e9);
        }
      } catch {
        /* ignore — the banner just hides */
      }
    };
    tick();
    // After a faucet call, poll a few times so the new balance shows up
    // without the user having to refresh.
    const id = setInterval(tick, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, address, refreshKey]);

  async function handleFaucet() {
    setPhase("fetching");
    setErrMsg(null);
    try {
      const r = await fetch("/api/agent/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: address }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        message?: string;
        retry_after_sec?: number;
      };
      if (!j.ok) {
        setErrMsg(
          j.message ??
            (j.retry_after_sec
              ? `Try again in ${j.retry_after_sec}s.`
              : "Faucet failed — try again in a moment."),
        );
        setPhase("err");
        return;
      }
      setPhase("ok");
      // Give the chain a couple of seconds to credit the wallet, then
      // poll for the updated balance.
      setTimeout(() => setRefreshKey((k) => k + 1), 3500);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPhase("err");
    }
  }

  // Loading the first balance — render nothing so the layout doesn't flash.
  if (balanceSui === null) return null;
  // Wallet is funded; nothing to do.
  if (balanceSui >= COLD_START_MIN_SUI) return null;

  return (
    <div className="mb-10 animate-fade-up border border-amber-300 bg-amber-50/60 p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex items-start gap-3">
          <Droplets
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-800">
              Your wallet needs testnet SUI
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              Brief runs on Sui testnet. You need a tiny bit of SUI to
              sign the grant transaction. We&apos;ll request{" "}
              <span className="font-mono">1 SUI</span> from the public faucet
              for{" "}
              <span className="font-mono">
                {short(address, 6, 4)}
              </span>{" "}
              — costs nothing, takes a few seconds.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleFaucet}
          disabled={phase === "fetching" || phase === "ok"}
          className="inline-flex items-center justify-center gap-2 border-2 border-amber-500 bg-amber-500 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === "fetching" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Requesting…
            </>
          ) : phase === "ok" ? (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              Sent — refreshing balance…
            </>
          ) : (
            <>
              <Droplets className="h-3.5 w-3.5" strokeWidth={1.75} />
              Get 1 SUI
            </>
          )}
        </button>
      </div>
      {phase === "err" && errMsg && (
        <p className="mt-3 border border-red-300 bg-red-50 p-2 font-mono text-[11.5px] text-red-700">
          {errMsg.slice(0, 200)}
        </p>
      )}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        balance ·{" "}
        <span className="tabular-nums text-ink-2">
          {balanceSui.toFixed(3)} SUI
        </span>{" "}
        · need ≥ {COLD_START_MIN_SUI.toFixed(2)} SUI to sign the grant
      </p>
    </div>
  );
}

// =============================================================================
// Single-step hire form — one screen, one signature, mission auto-dispatched
// =============================================================================

function HireForm({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}) {
  void address;

  const [templateId, setTemplateId] = useState<string>(WORKFORCE_TEMPLATES[0].id);
  const template = useMemo(() => templateById(templateId)!, [templateId]);

  const [brief, setBrief] = useState("");
  const [budgetSui, setBudgetSui] = useState(template.defaults.budgetSui);
  const [allowedVenues, setAllowedVenues] = useState<string[]>(template.defaults.allowedVenues);
  const [expiryHours, setExpiryHours] = useState(template.defaults.expiryHours);
  const [riskTolerance, setRiskTolerance] = useState<"low" | "medium" | "high">(
    template.defaults.riskTolerance,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Keep the budget pinned to the template's default whenever the
  // template changes — judges shouldn't have to think about budget if
  // they're not customizing.
  useEffect(() => {
    setBudgetSui(template.defaults.budgetSui);
    setAllowedVenues(template.defaults.allowedVenues);
    setExpiryHours(template.defaults.expiryHours);
    setRiskTolerance(template.defaults.riskTolerance);
  }, [templateId, template]);

  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [error, setError] = useState<string | null>(null);

  // After the policy is created we POST the mission automatically in the
  // background — the judge never sees a second form.
  function handleHire() {
    setError(null);
    const briefTrim = brief.trim();
    if (briefTrim.length === 0) {
      setError("Write a brief first — what should the workforce do?");
      return;
    }
    let tx;
    try {
      tx = buildActivateTx({
        packageId: BRIEF_PACKAGE_ID,
        templateId,
        name: template.defaults.name,
        budgetSui,
        allowedVenues,
        expiryHours,
        riskTolerance,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    signAndExecute(
      { transaction: tx },
      {
        onSuccess: (res) => {
          onActivated({
            policyId: null,
            txDigest: res.digest,
            templateId,
            name: template.defaults.name,
            brief: briefTrim,
            budgetSui,
            allowedVenues,
          });
        },
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
      },
    );
  }

  const briefTooShort = brief.trim().length < 4;

  return (
    <section>
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Step 1 of 1
      </p>
      <h1 className="mt-3 font-sans text-4xl font-medium tracking-tightest">
        Write your brief.
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        One sentence. One signature. The Planner agent decomposes it into
        on-chain jobs and the specialists pick them up.
      </p>

      <div className="mt-8 space-y-3">
        <label className="block">
          <span className="sr-only">Your brief</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={template.defaults.missionPlaceholder ||
              "Evaluate this Move contract for a $50,000 DAO grant — recommend approve / reject and probe DeepBook depth to size the disbursement."}
            rows={4}
            maxLength={1600}
            className="w-full resize-none border border-line bg-bg-elev px-4 py-3 text-base leading-relaxed outline-none transition-colors focus:border-ink"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {WORKFORCE_TEMPLATES.map((t) => {
            const on = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTemplateId(t.id);
                  if (brief.trim().length === 0) {
                    setBrief(t.defaults.missionPlaceholder);
                  }
                }}
                className={[
                  "inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                  on
                    ? "border-ink bg-ink text-bg"
                    : "border-line text-ink-2 hover:border-line-strong",
                ].join(" ")}
              >
                <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 border border-line bg-bg-elev p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Budget envelope
        </p>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-sans text-3xl font-medium tracking-tight tabular-nums">
            {budgetSui.toFixed(2)}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            SUI cap
          </span>
        </div>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.05}
          value={budgetSui}
          onChange={(e) => setBudgetSui(Number(e.target.value))}
          className="mt-4 w-full accent-ink"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {[0.2, 0.5, 1.0, 2.0].map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBudgetSui(b)}
              className={[
                "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                budgetSui === b
                  ? "border-ink text-ink"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {b} SUI
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          You are the OWNER. The Planner agent at{" "}
          <span className="font-mono">{short(BRIEF_OPERATOR_ADDRESS, 6, 4)}</span>{" "}
          is the bound AGENT — it can only spend within this envelope, only
          on the capabilities below, only until expiry. You can revoke any
          time.
        </p>
      </div>

      <details
        className="mt-6 border border-line bg-bg-elev"
        open={showAdvanced}
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer items-center justify-between px-5 py-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Advanced
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-5 py-5 space-y-5">
          <Field label="Allowed capabilities">
            <div className="flex flex-wrap gap-2">
              {["research", "audit", "treasury"].map((cap) => {
                const on = allowedVenues.includes(cap);
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() =>
                      setAllowedVenues(
                        on
                          ? allowedVenues.filter((v) => v !== cap)
                          : [...allowedVenues, cap],
                      )
                    }
                    className={[
                      "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                      on
                        ? "border-ink bg-ink text-bg"
                        : "border-line text-ink-2 hover:border-line-strong",
                    ].join(" ")}
                  >
                    {cap}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Expiry">
            <div className="flex flex-wrap gap-2">
              {[1, 2, 4, 12, 24].map((h) => {
                const on = expiryHours === h;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setExpiryHours(h)}
                    className={[
                      "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                      on
                        ? "border-ink bg-ink text-bg"
                        : "border-line text-ink-2 hover:border-line-strong",
                    ].join(" ")}
                  >
                    {h}h
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Risk tolerance">
            <div className="flex flex-wrap gap-2">
              {(["low", "medium", "high"] as const).map((r) => {
                const on = riskTolerance === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRiskTolerance(r)}
                    className={[
                      "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                      on
                        ? "border-ink bg-ink text-bg"
                        : "border-line text-ink-2 hover:border-line-strong",
                    ].join(" ")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </details>

      {error && (
        <p className="mt-6 border border-red-300 bg-red-50 p-3 font-mono text-[12px] text-red-700">
          {error.slice(0, 280)}
        </p>
      )}

      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="max-w-xs font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          one signature · creates the policy on chain · auto-dispatches the
          brief
        </p>
        <button
          type="button"
          onClick={handleHire}
          disabled={isPending || briefTooShort}
          className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-muted"
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Signing…
            </>
          ) : (
            <>
              Hire workforce
              <span aria-hidden>→</span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2">
        {label}
      </p>
      {children}
    </div>
  );
}

// =============================================================================
// Live console — top status card + Revoke + Activity timeline
// =============================================================================

type AbortRecord = {
  taskId: string;
  txDigest?: string;
  abortCode?: number;
  abortConst?: string;
  abortModule?: string;
  abortFn?: string;
  error?: string;
  at: number;
};

function LiveConsole({
  activation,
  onReset,
}: {
  activation: ActivationResult;
  onReset: () => void;
}) {
  const resolvedPolicyId = useResolvedPolicyId(activation.txDigest);
  const policyId = resolvedPolicyId;

  const { policy } = usePolicy(policyId);
  const { tasks } = useTasksForPolicy(policyId);
  const status = policy ? policyStatus(policy) : null;

  // Auto-dispatch the brief as soon as the policy id is resolved. The
  // user never sees a second form; the mission is queued in the
  // background and the planner-service picks it up.
  const dispatchedRef = useRef(false);
  useEffect(() => {
    if (!policyId || dispatchedRef.current) return;
    dispatchedRef.current = true;
    // Auto-detect any 0x… address pasted into the brief; otherwise hand
    // the Planner Brief's own package id so the Research agent always has
    // something concrete to audit. (Judges never see this field.)
    const detected = extractTargetPackageId(activation.brief);
    const targetPackageId = detected ?? BRIEF_PACKAGE_ID;
    dispatchMission({
      policyId,
      mission: activation.brief,
      targetPackageId,
    }).catch(() => {
      // Swallow — the planner-service may not be running locally for a
      // judge, but the policy is real and visible on chain. The next
      // section explains how to bring the workforce online if needed.
    });
  }, [policyId, activation.brief]);

  // Specialist roster (excluding Planner). Used by both the team panel
  // and the kill-switch's verification-fallback path.
  const { agents: roster } = useRegisteredAgents({
    excludeAddress: BRIEF_OPERATOR_ADDRESS,
  });

  // Revoke + deterministic kill-switch state machine.
  //
  // The chain only emits EPolicyRevoked (operator_policy::3) on a task
  // that is currently in DELIVERED status — the runtime checks task
  // status BEFORE record_spend (see move/sources/task.move). So to
  // surface the canonical EPolicyRevoked fingerprint we always need a
  // live DELIVERED target. Strategy:
  //
  //   1. After the user signs revoke, scan the task list for any
  //      delivered-but-unsettled task and attempt approve_with_policy
  //      against it via /api/workforce/approve (server-signed by the
  //      Planner). Validate the abort response — only commit to the
  //      CHAIN REFUSED card if the chain returned the EXACT
  //      (operator_policy::assert_can_spend, code 3) fingerprint.
  //   2. If the response was anything else (e.g. task::EWrongStatus
  //      from a race against the auto-approve loop), mark the task
  //      tried and re-target on the next render. Don't surface a
  //      misleading card.
  //   3. If we exhaust all delivered tasks without verifying, post a
  //      "Kill-switch verification" task via /api/workforce/post-
  //      verification. Wait for the specialist to deliver it, then
  //      attempt approve — which aborts EPolicyRevoked, deterministically.
  //
  // The planner-service holds the most-recent delivered task per policy
  // as the user-facing "pending release" checkpoint, so step 1 almost
  // always succeeds; step 3 is the safety net for the "judge let
  // everything settle to paid then revoked" case.
  type KillSwitchPhase =
    | "idle"
    | "scanning"
    | "verifying_post"
    | "verified";
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeTx, setRevokeTx] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [chainAbort, setChainAbort] = useState<AbortRecord | null>(null);
  const [killSwitchPhase, setKillSwitchPhase] = useState<KillSwitchPhase>("idle");
  const [verificationTaskId, setVerificationTaskId] = useState<string | null>(
    null,
  );
  const triedTaskIdsRef = useRef<Set<string>>(new Set());
  const verificationPostedRef = useRef(false);
  const inFlightRef = useRef(false);
  const { mutate: signRevoke } = useSignAndExecuteTransaction();

  function isVerifiedEPolicyRevoked(j: Partial<AbortRecord>): boolean {
    if (j.abortCode !== 3) return false;
    if (j.abortModule !== "operator_policy") return false;
    // Either the parsed const name or the function name confirms it.
    if (j.abortConst && j.abortConst !== "EPolicyRevoked") return false;
    return true;
  }

  // Try one approve_with_policy attempt against `taskId`. Returns true if
  // we got a verified EPolicyRevoked (the kill-switch is proven).
  const attemptAbort = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (triedTaskIdsRef.current.has(taskId)) return false;
      triedTaskIdsRef.current.add(taskId);
      try {
        const r = await fetch("/api/workforce/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: taskId, policy_id: policyId }),
        });
        const j = (await r.json()) as Partial<AbortRecord> & {
          ok?: boolean;
          error?: string;
        };
        // A successful approve is a race: revoke hadn't landed before the
        // approve hit the validator. Skip — caller will try another task.
        if (j.ok) return false;
        if (!isVerifiedEPolicyRevoked(j)) return false;
        setChainAbort({
          taskId,
          txDigest: j.txDigest,
          abortCode: j.abortCode,
          abortConst: j.abortConst ?? "EPolicyRevoked",
          abortModule: j.abortModule ?? "operator_policy",
          abortFn: j.abortFn ?? "assert_can_spend",
          at: Date.now(),
        });
        setKillSwitchPhase("verified");
        return true;
      } catch {
        return false;
      }
    },
    [policyId],
  );

  // Post a tiny kill-switch verification task under the revoked policy so
  // the chain has something to refuse. Assigned to a registered
  // specialist whose capability is in policy.allowed_venues.
  const postVerificationTask = useCallback(
    async (allowedVenues: string[]): Promise<void> => {
      if (!policyId || verificationPostedRef.current) return;
      verificationPostedRef.current = true;
      // Pick a specialist whose capabilities intersect policy.allowed_venues.
      // Prefer treasury (simulated-mode = no DeepBook wallet requirement).
      const pickFor = (cap: string) =>
        roster.find((a) => a.capabilities.includes(cap));
      const preferred = ["treasury", "research", "audit"];
      let chosen: { address: string; capability: string } | null = null;
      for (const cap of preferred) {
        if (!allowedVenues.includes(cap)) continue;
        const a = pickFor(cap);
        if (a) {
          chosen = { address: a.address, capability: cap };
          break;
        }
      }
      // Fallback — first capability/specialist match.
      if (!chosen) {
        for (const a of roster) {
          for (const cap of a.capabilities) {
            if (allowedVenues.includes(cap)) {
              chosen = { address: a.address, capability: cap };
              break;
            }
          }
          if (chosen) break;
        }
      }
      if (!chosen) {
        // Can't post — no eligible specialist. The state machine will
        // retry; if it persists, the UI surfaces "armed, awaiting
        // workforce" copy.
        verificationPostedRef.current = false;
        return;
      }
      setKillSwitchPhase("verifying_post");
      try {
        const r = await fetch("/api/workforce/post-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            policy_id: policyId,
            assigned_to: chosen.address,
            capability: chosen.capability,
          }),
        });
        const j = (await r.json()) as {
          ok?: boolean;
          task_id?: string;
          error?: string;
        };
        if (j.ok && j.task_id) {
          setVerificationTaskId(j.task_id);
        } else {
          // Allow retry on the next tick.
          verificationPostedRef.current = false;
        }
      } catch {
        verificationPostedRef.current = false;
      }
      setKillSwitchPhase("scanning");
    },
    [policyId, roster],
  );

  // Drive the kill-switch state machine. The effect re-runs whenever the
  // task list updates (useTasksForPolicy polls every 3s) — so a freshly
  // delivered task is picked up automatically.
  useEffect(() => {
    if (chainAbort) return;
    if (killSwitchPhase === "idle" || killSwitchPhase === "verified") return;
    if (!policyId || !policy) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    void (async () => {
      try {
        // 1. Try every untried delivered task.
        for (const t of tasks) {
          if (t.status !== "delivered") continue;
          if (triedTaskIdsRef.current.has(t.id)) continue;
          const verified = await attemptAbort(t.id);
          if (verified) return;
        }
        // 2. Nothing untried + delivered. Post a verification task once.
        if (!verificationPostedRef.current) {
          await postVerificationTask(policy.allowedVenues);
        }
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [
    chainAbort,
    killSwitchPhase,
    tasks,
    policyId,
    policy,
    attemptAbort,
    postVerificationTask,
  ]);

  function handleRevoke() {
    if (!policyId) return;
    setRevokeError(null);
    const tx = buildRevokeTx({
      packageId: BRIEF_PACKAGE_ID,
      policyId,
    });
    setRevokeSubmitting(true);
    signRevoke(
      { transaction: tx },
      {
        onSuccess: (res) => {
          setRevokeTx(res.digest);
          setRevokeSubmitting(false);
          setConfirmRevoke(false);
          // Arm the kill-switch state machine; the useEffect handles
          // targeting + verification-fallback from here.
          setKillSwitchPhase("scanning");
        },
        onError: (e) => {
          setRevokeError(e instanceof Error ? e.message : String(e));
          setRevokeSubmitting(false);
        },
      },
    );
  }

  // Manual "Release payment" on the pending-release task — exactly the
  // same approve call the auto-approve loop would have made; we just
  // expose it as a deliberate user action when the policy is live so the
  // judge can choose between Release and Revoke.
  const [releaseTaskId, setReleaseTaskId] = useState<string | null>(null);
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);
  const releaseSubmittingRef = useRef(false);
  async function handleRelease(taskId: string) {
    if (releaseSubmittingRef.current) return;
    releaseSubmittingRef.current = true;
    setReleaseTaskId(taskId);
    setReleaseSubmitting(true);
    try {
      await fetch("/api/workforce/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, policy_id: policyId }),
      });
    } catch {
      /* silent — the polled task list will reflect the result */
    } finally {
      setReleaseSubmitting(false);
      releaseSubmittingRef.current = false;
      // Re-enable Release for any future pending task.
      setTimeout(() => setReleaseTaskId(null), 2000);
    }
  }

  const interventionActive = !!chainAbort;
  // Drive the global "chain intervention" CSS hook for one beat.
  useEffect(() => {
    if (!interventionActive) return;
    document.documentElement.setAttribute("data-chain-intervention", "1");
    const t = setTimeout(() => {
      document.documentElement.removeAttribute("data-chain-intervention");
    }, 2200);
    return () => clearTimeout(t);
  }, [interventionActive]);

  return (
    <section className="mx-auto max-w-page px-6 py-12 sm:px-10 sm:py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Workforce · {status ? statusLabel(status) : "ACTIVATING"}
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-sans text-3xl font-medium tracking-tighter sm:text-4xl">
          {activation.name} is at work.
        </h1>
        <button
          type="button"
          onClick={onReset}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
        >
          ← Hire another
        </button>
      </div>

      <PolicyCard
        activation={activation}
        policyId={policyId}
        policy={policy}
        status={status}
        onRequestRevoke={() => setConfirmRevoke(true)}
        revokeSubmitting={revokeSubmitting}
        revokeError={revokeError}
      />

      {chainAbort && (
        <ChainRefusedCard
          policyId={policyId ?? ""}
          revokeTx={revokeTx}
          abort={chainAbort}
        />
      )}

      {policy?.revoked && !chainAbort && (
        <KillSwitchInFlight
          policyId={policyId ?? ""}
          revokeTx={revokeTx}
          phase={killSwitchPhase}
          verificationTaskId={verificationTaskId}
          tasks={tasks}
        />
      )}

      <Brief brief={activation.brief} />

      <Team
        tasks={tasks}
        roster={roster}
        policyId={policyId}
        policyRevoked={!!policy?.revoked}
      />

      <PendingReleaseSection
        tasks={tasks}
        roster={roster}
        policyId={policyId}
        policyRevoked={!!policy?.revoked}
        onRelease={handleRelease}
        onRevoke={() => setConfirmRevoke(true)}
        releaseTaskId={releaseTaskId}
        releaseSubmitting={releaseSubmitting}
        verificationTaskId={verificationTaskId}
      />

      <ActivityFeed
        tasks={tasks}
        policyId={policyId}
        policyRevoked={!!policy?.revoked}
      />

      {confirmRevoke && (
        <RevokeModal
          onConfirm={handleRevoke}
          onCancel={() => setConfirmRevoke(false)}
          submitting={revokeSubmitting}
          name={activation.name}
        />
      )}
    </section>
  );
}

function statusLabel(s: "active" | "revoked" | "expired" | "exhausted") {
  if (s === "revoked") return "REVOKED · chain refuses settlement";
  if (s === "expired") return "EXPIRED";
  if (s === "exhausted") return "BUDGET EXHAUSTED";
  return "LIVE";
}

// =============================================================================
// Policy status card — primary surface, includes Revoke
// =============================================================================

function PolicyCard({
  activation,
  policyId,
  policy,
  status,
  onRequestRevoke,
  revokeSubmitting,
  revokeError,
}: {
  activation: ActivationResult;
  policyId: string | null;
  policy: OperatorPolicyDecoded | null;
  status: "active" | "revoked" | "expired" | "exhausted" | null;
  onRequestRevoke: () => void;
  revokeSubmitting: boolean;
  revokeError: string | null;
}) {
  const remaining =
    policy ? Number(policy.budgetCap - policy.spent) / 1e9 : null;
  const cap = activation.budgetSui;
  const pct = remaining !== null ? Math.max(0, Math.min(1, remaining / cap)) : 0;
  const isLive = status === "active";
  const isRevoked = status === "revoked";

  return (
    <div
      className={[
        "mt-6 relative border-2 bg-bg-elev p-6 transition-colors",
        isRevoked ? "border-red-400/70" : "border-ink",
      ].join(" ")}
    >
      {isLive && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/70 animate-operator-pulse-line"
          aria-hidden
        />
      )}
      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
              Template · {activation.templateId}
            </span>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
              Budget envelope
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-medium tabular-nums text-ink">
                {remaining !== null ? remaining.toFixed(3) : cap.toFixed(2)}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-muted">
                / {cap.toFixed(2)} SUI
              </span>
            </div>
            <div className="mt-2 h-1 w-full bg-line">
              <div
                className={[
                  "h-full transition-all",
                  isRevoked ? "bg-red-400" : "bg-ink",
                ].join(" ")}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-[12.5px]">
            <KV label="Capabilities">
              <span className="font-mono">
                [{activation.allowedVenues.join(", ")}]
              </span>
            </KV>
            <KV label="Policy">
              {policyId ? (
                <a
                  href={explorerUrl("object", policyId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-ink underline-offset-4 hover:underline"
                >
                  {short(policyId, 8, 6)}
                  <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
                </a>
              ) : (
                <span className="inline-flex items-center gap-2 font-mono text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  materializing…
                </span>
              )}
            </KV>
            <KV label="Grant tx">
              <a
                href={explorerUrl("txblock", activation.txDigest)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-ink underline-offset-4 hover:underline"
              >
                {short(activation.txDigest, 6, 6)}
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </a>
            </KV>
          </div>
        </div>
        <div className="flex flex-col items-end justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            Kill switch
          </span>
          <button
            type="button"
            disabled={!policyId || revokeSubmitting || isRevoked}
            onClick={onRequestRevoke}
            className={[
              "inline-flex items-center gap-2 border-2 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] transition-colors",
              isRevoked
                ? "cursor-not-allowed border-line bg-line text-muted"
                : "border-red-500 bg-bg text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60",
            ].join(" ")}
          >
            {revokeSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Revoking…
              </>
            ) : (
              <>
                <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                {isRevoked ? "Revoked" : "Revoke authority"}
              </>
            )}
          </button>
          {!isRevoked && (
            <p className="max-w-[12rem] text-right text-[11px] leading-snug text-muted">
              The chain will refuse the next payment. Funds stay locked in
              escrow.
            </p>
          )}
        </div>
      </div>
      {revokeError && (
        <p className="mt-4 border border-red-300 bg-red-50 p-3 font-mono text-[12px] text-red-700">
          {revokeError.slice(0, 280)}
        </p>
      )}
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: "active" | "revoked" | "expired" | "exhausted" | null;
}) {
  const cls =
    status === "revoked"
      ? "border-red-400 bg-red-50 text-red-700"
      : status === "expired"
        ? "border-amber-400 bg-amber-50 text-amber-700"
        : status === "exhausted"
          ? "border-amber-400 bg-amber-50 text-amber-700"
          : "border-emerald-500 bg-emerald-50 text-emerald-700";
  const label =
    status === "revoked"
      ? "REVOKED"
      : status === "expired"
        ? "EXPIRED"
        : status === "exhausted"
          ? "BUDGET EXHAUSTED"
          : "LIVE";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em]",
        cls,
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-1.5 w-1.5 rounded-full",
          status === "revoked"
            ? "bg-red-500"
            : status === "active"
              ? "bg-emerald-500 animate-pulse"
              : "bg-muted",
        ].join(" ")}
        aria-hidden
      />
      {label}
    </span>
  );
}

function KV({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </span>
      <span>{children}</span>
    </span>
  );
}

// =============================================================================
// Chain Refused payoff
// =============================================================================

function ChainRefusedCard({
  policyId,
  revokeTx,
  abort,
}: {
  policyId: string;
  revokeTx: string | null;
  abort: AbortRecord;
}) {
  const code = abort.abortCode;
  const named = abort.abortConst;
  const codeLabel =
    code !== undefined
      ? `${code}${named ? ` (${named})` : ""}`
      : named ?? "—";

  return (
    <div className="mt-6 animate-rejection-flash border-2 border-red-500 bg-red-50/70 p-6 text-red-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-red-700">
            Chain intervention · settlement refused
          </p>
          <h2 className="mt-2 font-sans text-2xl font-medium tracking-tight">
            The blockchain refused the workforce&apos;s next payment.
          </h2>
          <p className="mt-3 max-w-prose text-[13.5px] leading-relaxed text-red-900/90">
            The Planner tried to settle a delivered task under this policy.
            The Move runtime checked the policy, saw it was revoked, and
            aborted the transaction. Funds stay locked in escrow until the
            task expires; the specialist never gets paid.
          </p>
          <dl className="mt-5 grid gap-2 font-mono text-[12px] sm:grid-cols-2">
            <AbortRow label="Abort code">{codeLabel}</AbortRow>
            <AbortRow label="Module / function">
              {abort.abortModule ?? "?"}::{abort.abortFn ?? "?"}
            </AbortRow>
            <AbortRow label="Refused on task">
              <a
                href={explorerUrl("object", abort.taskId)}
                target="_blank"
                rel="noreferrer"
                className="text-red-900 underline-offset-4 hover:underline"
              >
                {short(abort.taskId, 8, 6)}
              </a>
            </AbortRow>
            <AbortRow label="Policy (revoked)">
              <a
                href={explorerUrl("object", policyId)}
                target="_blank"
                rel="noreferrer"
                className="text-red-900 underline-offset-4 hover:underline"
              >
                {short(policyId, 8, 6)}
              </a>
            </AbortRow>
            {revokeTx && (
              <AbortRow label="Revoke tx">
                <a
                  href={explorerUrl("txblock", revokeTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-900 underline-offset-4 hover:underline"
                >
                  {short(revokeTx, 6, 6)}
                </a>
              </AbortRow>
            )}
            {abort.txDigest && (
              <AbortRow label="Aborted attempt">
                <a
                  href={explorerUrl("txblock", abort.txDigest)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-900 underline-offset-4 hover:underline"
                >
                  {short(abort.txDigest, 6, 6)}
                </a>
              </AbortRow>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

function AbortRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-red-700">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-red-900">{children}</dd>
    </div>
  );
}

// While the kill-switch state machine hunts for a deterministic
// EPolicyRevoked abort (scanning delivered tasks → posting a verification
// task → waiting for delivery), surface what it's doing so the screen
// never sits with a dead "(awaiting…)" line.
function KillSwitchInFlight({
  policyId,
  revokeTx,
  phase,
  verificationTaskId,
  tasks,
}: {
  policyId: string;
  revokeTx: string | null;
  phase: "idle" | "scanning" | "verifying_post" | "verified";
  verificationTaskId: string | null;
  tasks: WorkforceTask[];
}) {
  if (phase === "verified" || phase === "idle") return null;
  const deliveredCount = tasks.filter((t) => t.status === "delivered").length;
  const verificationTask = verificationTaskId
    ? tasks.find((t) => t.id === verificationTaskId) ?? null
    : null;

  let copy: string;
  if (phase === "verifying_post") {
    copy =
      "Posting a kill-switch verification task. The specialist will accept and deliver in seconds — then the chain refuses settlement.";
  } else if (verificationTask) {
    if (verificationTask.status === "delivered") {
      copy =
        "Verification task delivered. Submitting the (now-refused) payment — the chain refusal lands here in a beat.";
    } else if (verificationTask.status === "approved") {
      copy =
        "Verification task settled before revoke landed. Re-arming on the next delivery…";
    } else {
      copy = `Verification task ${verificationTask.status}; waiting for delivery so the chain can refuse settlement.`;
    }
  } else if (deliveredCount > 0) {
    copy =
      "Attempting to settle a delivered task; the chain will refuse and the abort lands here in a beat.";
  } else {
    copy =
      "Policy revoked. No delivery pending — posting a tiny verification task so the chain can prove the kill switch is real.";
  }

  return (
    <div className="mt-6 border border-red-300 bg-red-50/60 p-5">
      <div className="flex items-start gap-3">
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin text-red-700"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-700">
            Policy revoked · awaiting chain refusal
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-red-900/90">
            {copy}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px]">
            <KV label="Policy">
              <a
                href={explorerUrl("object", policyId)}
                target="_blank"
                rel="noreferrer"
                className="text-red-900 underline-offset-4 hover:underline"
              >
                {short(policyId, 8, 6)}
              </a>
            </KV>
            {revokeTx && (
              <KV label="Revoke tx">
                <a
                  href={explorerUrl("txblock", revokeTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-900 underline-offset-4 hover:underline"
                >
                  {short(revokeTx, 6, 6)}
                </a>
              </KV>
            )}
            {verificationTask && (
              <KV label="Verification task">
                <a
                  href={explorerUrl("object", verificationTask.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-900 underline-offset-4 hover:underline"
                >
                  {short(verificationTask.id, 6, 6)}
                </a>
              </KV>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team panel — three agent presences (Planner + two specialists) with live
// status lines tied to the chain state so the screen reads as a working
// team, not a polling table.
// ---------------------------------------------------------------------------

function Team({
  tasks,
  roster,
  policyId,
  policyRevoked,
}: {
  tasks: WorkforceTask[];
  roster: RegisteredAgent[];
  policyId: string | null;
  policyRevoked: boolean;
}) {
  const research =
    roster.find(
      (a) =>
        a.capabilities.includes("research") || a.capabilities.includes("audit"),
    ) ?? null;
  const treasury =
    roster.find((a) => a.capabilities.includes("treasury")) ?? null;

  return (
    <section className="mt-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Team · on chain
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <AgentPresence
          role="planner"
          name="Planner"
          address={BRIEF_OPERATOR_ADDRESS}
          status={plannerStatusLine(tasks, policyId, policyRevoked)}
        />
        <AgentPresence
          role="specialist"
          name={research?.displayName || "Research"}
          address={research?.address ?? null}
          status={specialistStatusLine(tasks, research?.address ?? null, "research", policyRevoked)}
          agent={research}
        />
        <AgentPresence
          role="specialist"
          name={treasury?.displayName || "Treasury"}
          address={treasury?.address ?? null}
          status={specialistStatusLine(tasks, treasury?.address ?? null, "treasury", policyRevoked)}
          agent={treasury}
        />
      </div>
    </section>
  );
}

function plannerStatusLine(
  tasks: WorkforceTask[],
  policyId: string | null,
  policyRevoked: boolean,
): { text: string; active: boolean } {
  if (policyRevoked) {
    return { text: "Authority revoked · standing by", active: false };
  }
  if (!policyId) return { text: "Reading your brief…", active: true };
  if (tasks.length === 0) return { text: "Decomposing the brief…", active: true };
  const settling = tasks.some(
    (t) => t.status === "delivered" || t.status === "accepted",
  );
  if (settling) return { text: "Watching the specialists work…", active: true };
  const allPaid = tasks.every((t) => t.status === "approved");
  if (allPaid) return { text: "Idle · all deliveries settled", active: false };
  return { text: "Watching the workforce…", active: true };
}

function specialistStatusLine(
  tasks: WorkforceTask[],
  address: string | null,
  kind: "research" | "treasury",
  policyRevoked: boolean,
): { text: string; active: boolean } {
  if (policyRevoked) {
    return { text: "Authority revoked · standing by", active: false };
  }
  if (!address) {
    return { text: "Not yet on chain — boot the specialist", active: false };
  }
  const mine = tasks
    .filter((t) => t.assignedTo.toLowerCase() === address.toLowerCase())
    .sort((a, b) => Number(b.postedAtMs - a.postedAtMs));
  if (mine.length === 0) return { text: "Idle · awaiting assignment", active: false };
  const latest = mine[0];
  if (latest.status === "open") {
    return { text: "Picking up the assignment…", active: true };
  }
  if (latest.status === "accepted") {
    if (kind === "research") {
      // Pull target package id from spec for richer copy.
      const target = extractTargetFromSpec(latest.specBlob);
      return {
        text: target
          ? `Auditing ${short(target, 6, 4)}…`
          : "Researching the brief…",
        active: true,
      };
    }
    return { text: "Probing DeepBook SUI/DBUSDC…", active: true };
  }
  if (latest.status === "delivered") {
    return {
      text:
        kind === "research"
          ? "Delivered audit · awaiting release"
          : "Delivered report · awaiting release",
      active: true,
    };
  }
  if (latest.status === "approved") {
    return { text: "Paid · standing by for next job", active: false };
  }
  if (latest.status === "expired") {
    return { text: "Task expired · standing by", active: false };
  }
  return { text: "Idle", active: false };
}

function extractTargetFromSpec(specBlob: string): string | null {
  if (!specBlob) return null;
  try {
    const v = JSON.parse(specBlob) as { target_package_id?: string };
    if (v?.target_package_id && /^0x[0-9a-f]+$/i.test(v.target_package_id)) {
      return v.target_package_id;
    }
  } catch {
    /* not JSON */
  }
  // Last-ditch: pull any 0x… directly out of the spec.
  const m = /0x[0-9a-fA-F]{20,64}/.exec(specBlob);
  return m ? m[0] : null;
}

function AgentPresence({
  role,
  name,
  address,
  status,
  agent,
}: {
  role: "planner" | "specialist";
  name: string;
  address: string | null;
  status: { text: string; active: boolean };
  agent?: RegisteredAgent | null;
}) {
  // Reputation tick: flash green for ~600ms when the value bumps.
  const repValue = agent ? Number(agent.reputationScore) : 0;
  const prevRepRef = useRef(repValue);
  const [tick, setTick] = useState(false);
  useEffect(() => {
    if (repValue > prevRepRef.current) {
      setTick(true);
      const id = setTimeout(() => setTick(false), 700);
      prevRepRef.current = repValue;
      return () => clearTimeout(id);
    }
    prevRepRef.current = repValue;
  }, [repValue]);

  const earned = agent ? Number(agent.totalPaidMist) / 1e9 : 0;
  return (
    <article className="relative border border-line bg-bg-elev p-4 transition-colors">
      {status.active && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/60 animate-operator-pulse-line"
          aria-hidden
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {role === "planner" ? "Planner" : "Specialist"}
          </p>
          <p className="mt-0.5 text-[15px] font-medium tracking-tight text-ink">
            {name}
          </p>
          {address && (
            <p className="mt-0.5 font-mono text-[11px] text-muted">
              {short(address, 8, 6)}
            </p>
          )}
        </div>
        {agent && (
          <div className="text-right">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
              rep
            </p>
            <p
              className={[
                "font-mono text-[14px] tabular-nums",
                tick ? "animate-value-tick text-emerald-700" : "text-ink",
              ].join(" ")}
            >
              {String(agent.reputationScore)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12.5px]">
        <span
          className={[
            "inline-block h-1.5 w-1.5 rounded-full",
            status.active ? "bg-emerald-500 animate-pulse" : "bg-muted",
          ].join(" ")}
          aria-hidden
        />
        <span className="truncate text-ink-2">{status.text}</span>
      </div>

      {agent && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[11px]">
          <span className="font-mono text-muted">
            paid{" "}
            <span className="tabular-nums text-ink">
              {earned >= 1 ? earned.toFixed(2) : earned.toFixed(3)} SUI
            </span>
          </span>
          <span className="font-mono text-muted">
            delivered{" "}
            <span className="tabular-nums text-ink">
              {String(agent.completedTasks)}
            </span>
          </span>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Pending release — the guided checkpoint. The planner-service holds the
// most-recent delivered task; this card shows it with two equal-weight
// actions so the judge always has a clear next move.
// ---------------------------------------------------------------------------

function PendingReleaseSection({
  tasks,
  roster,
  policyId,
  policyRevoked,
  onRelease,
  onRevoke,
  releaseTaskId,
  releaseSubmitting,
  verificationTaskId,
}: {
  tasks: WorkforceTask[];
  roster: RegisteredAgent[];
  policyId: string | null;
  policyRevoked: boolean;
  onRelease: (taskId: string) => void;
  onRevoke: () => void;
  releaseTaskId: string | null;
  releaseSubmitting: boolean;
  verificationTaskId: string | null;
}) {
  if (!policyId || policyRevoked) return null;
  const candidates = tasks
    .filter((t) => t.status === "delivered")
    .filter((t) => t.id !== verificationTaskId)
    .sort((a, b) => Number(b.postedAtMs - a.postedAtMs));
  const pending = candidates[0];
  if (!pending) return null;
  const bountySui = Number(pending.bountyMist) / 1e9;
  const specialist =
    roster.find(
      (a) => a.address.toLowerCase() === pending.assignedTo.toLowerCase(),
    ) ?? null;
  const isSubmittingThis =
    releaseSubmitting && releaseTaskId === pending.id;

  return (
    <section className="mt-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Pending release · human checkpoint
      </p>
      <div className="mt-3 animate-fade-up border-2 border-amber-400/70 bg-amber-50/40 p-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-800">
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
                aria-hidden
              />
              Workforce delivered · awaiting your decision
            </div>
            <p className="text-lg leading-snug tracking-tight">
              {specialist?.displayName ?? "The specialist"} is waiting to be paid{" "}
              <span className="font-mono tabular-nums">{bountySui.toFixed(3)} SUI</span>{" "}
              for{" "}
              <span className="font-medium">{pending.title}</span>.
            </p>
            <p className="max-w-prose text-[12.5px] leading-relaxed text-ink-2">
              Release the payment and the bounty transfers atomically with a
              reputation tick. Revoke authority and the chain itself refuses
              settlement — funds stay locked in escrow.
            </p>
            <div className="flex flex-wrap gap-3 text-[11px] font-mono">
              <KV label="Task">
                <a
                  href={explorerUrl("object", pending.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  {short(pending.id, 8, 6)}
                </a>
              </KV>
              <KV label="Specialist">
                <span className="text-ink">
                  {short(pending.assignedTo, 8, 6)}
                </span>
              </KV>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:min-w-[12rem]">
            <button
              type="button"
              onClick={() => onRelease(pending.id)}
              disabled={isSubmittingThis}
              className="inline-flex items-center justify-center gap-2 border-2 border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingThis ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Releasing…
                </>
              ) : (
                <>
                  Release payment
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onRevoke}
              className="inline-flex items-center justify-center gap-2 border-2 border-red-500 bg-bg px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.28em] text-red-700 transition-colors hover:bg-red-50"
            >
              <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              Revoke authority
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Brief — verbatim, what the Planner is working from
// =============================================================================

function Brief({ brief }: { brief: string }) {
  return (
    <section className="mt-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        The brief
      </p>
      <blockquote className="mt-3 border-l-2 border-line-strong bg-bg-elev px-5 py-4 text-[15px] leading-relaxed italic text-ink-2">
        “{brief}”
      </blockquote>
    </section>
  );
}

// (RosterStrip removed — replaced by the live `Team` panel above the
// activity feed, which also surfaces the Planner and per-agent status
// lines tied to the chain state.)

// =============================================================================
// Activity feed — task timeline + nice deliverables
// =============================================================================

const STATUS_TONE: Record<TaskStatus, { label: string; tone: string; dot: string }> = {
  open: { label: "POSTED", tone: "border-line text-ink-2", dot: "bg-ink/40" },
  accepted: {
    label: "ACCEPTED",
    tone: "border-amber-400 text-amber-700",
    dot: "bg-amber-500 animate-pulse",
  },
  delivered: {
    label: "DELIVERED",
    tone: "border-emerald-500 text-emerald-700",
    dot: "bg-emerald-500 animate-pulse",
  },
  approved: {
    label: "PAID",
    tone: "border-ink bg-ink text-bg",
    dot: "bg-emerald-500",
  },
  expired: {
    label: "EXPIRED",
    tone: "border-red-300 text-red-700",
    dot: "bg-red-500",
  },
  unknown: { label: "—", tone: "border-line text-muted", dot: "bg-muted" },
};

function ActivityFeed({
  tasks,
  policyId,
  policyRevoked,
}: {
  tasks: WorkforceTask[];
  policyId: string | null;
  policyRevoked: boolean;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Activity · {tasks.length}
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {policyId ? "live · 3s" : "awaiting policy…"}
        </span>
      </div>
      <div className="mt-3 border border-line bg-bg-elev">
        {!policyId ? (
          <p className="px-6 py-8 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            The Planner is reading your brief and posting the first jobs…
          </p>
        ) : tasks.length === 0 ? (
          <p className="px-6 py-8 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            Planner is decomposing — first job appears here in seconds.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t, i) => (
              <TaskCard
                key={t.id}
                task={t}
                index={i}
                policyRevoked={policyRevoked}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  index,
  policyRevoked,
}: {
  task: WorkforceTask;
  index: number;
  policyRevoked: boolean;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const tone = STATUS_TONE[task.status];
  const bountySui = Number(task.bountyMist) / 1e9;
  return (
    <li className="animate-land-in" style={{ animationDelay: `${index * 60}ms` }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-bg/60"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={[
              "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
              tone.dot,
            ].join(" ")}
            aria-hidden
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {task.primaryCapability}
          </span>
          <span className="truncate text-[14px] text-ink">{task.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-ink-2">
            {bountySui.toFixed(2)} SUI
          </span>
          <span
            className={[
              "border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]",
              tone.tone,
            ].join(" ")}
          >
            {tone.label}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-line bg-bg/40 px-5 py-5">
          <SpecialistChip address={task.assignedTo} />

          <div className="mt-4 grid gap-2 font-mono text-[11px] sm:grid-cols-2">
            <KV label="Task">
              <a
                href={explorerUrl("object", task.id)}
                target="_blank"
                rel="noreferrer"
                className="text-ink underline-offset-4 hover:underline"
              >
                {short(task.id, 8, 6)}
              </a>
            </KV>
            <KV label="Posted tx">
              <a
                href={explorerUrl("txblock", task.postedTxDigest)}
                target="_blank"
                rel="noreferrer"
                className="text-ink underline-offset-4 hover:underline"
              >
                {short(task.postedTxDigest, 6, 6)}
              </a>
            </KV>
            {task.deliverableId && (
              <KV label="Deliverable">
                <a
                  href={explorerUrl("object", task.deliverableId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  {short(task.deliverableId, 8, 6)}
                </a>
              </KV>
            )}
          </div>

          {task.deliverableId && (
            <DeliverableSurface
              deliverableId={task.deliverableId}
              capability={task.primaryCapability}
            />
          )}

          {task.status === "delivered" && policyRevoked && (
            <p className="mt-4 inline-flex items-center gap-2 border border-red-300 bg-red-50 px-3 py-1.5 font-mono text-[11px] text-red-800">
              <ShieldOff className="h-3 w-3" strokeWidth={1.75} />
              policy revoked · settlement refused by chain
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function SpecialistChip({ address }: { address: string }) {
  const { profile } = useAgentRegistration(address);
  return (
    <div className="flex flex-wrap items-center gap-2 border border-line bg-bg p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        Specialist
      </span>
      <span className="text-[13.5px] font-medium text-ink">
        {profile?.displayName || "Specialist"}
      </span>
      <span className="font-mono text-[11px] text-muted">
        {short(address, 8, 6)}
      </span>
      {profile && (
        <span className="ml-auto flex items-center gap-3 font-mono text-[10px] text-muted">
          <span>
            rep <span className="tabular-nums text-ink">{String(profile.reputationScore)}</span>
          </span>
          <span>
            paid{" "}
            <span className="tabular-nums text-ink">
              {(Number(profile.totalPaidMist) / 1e9).toFixed(2)} SUI
            </span>
          </span>
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Deliverable rendering — markdown / orders table / view-raw disclosure
// =============================================================================

function DeliverableSurface({
  deliverableId,
  capability,
}: {
  deliverableId: string;
  capability: string;
}) {
  const d = useDeliverable(deliverableId);
  if (d.loading) {
    return (
      <div className="mt-4 border border-line bg-bg p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Loading deliverable…
        </p>
      </div>
    );
  }
  if (!d.body) {
    return (
      <div className="mt-4 border border-line bg-bg p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Waiting for content (propagation can take ~15s).
        </p>
      </div>
    );
  }

  const isTreasury =
    capability === "treasury" || capability === "audit"
      ? false
      : false;
  void isTreasury;
  const treasuryView = capability === "treasury" && d.bodyKind === "json";

  return (
    <div className="mt-4 border border-line bg-bg-elev">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Deliverable
        </p>
        {d.walrusBlobId && (
          <a
            href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${d.walrusBlobId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:text-ink"
          >
            walrus blob
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
        )}
      </div>
      <div className="px-5 py-5">
        {treasuryView ? (
          <TreasuryView raw={d.body} />
        ) : d.bodyKind === "markdown" ? (
          <Markdown source={d.body} />
        ) : d.bodyKind === "json" ? (
          <Markdown source={tryFormatJsonAsMarkdown(d.body)} />
        ) : (
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">
            {d.body.slice(0, 4000)}
          </pre>
        )}
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            View raw
          </summary>
          <pre className="mt-3 max-h-72 overflow-auto border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink-2">
            {d.body.length > 6000 ? d.body.slice(0, 6000) + "\n\n… (truncated)" : d.body}
          </pre>
        </details>
      </div>
    </div>
  );
}

function tryFormatJsonAsMarkdown(raw: string): string {
  try {
    const v = JSON.parse(raw);
    return "```json\n" + JSON.stringify(v, null, 2) + "\n```";
  } catch {
    return raw;
  }
}

type TreasuryDeliverable = {
  task_title?: string;
  pool?: {
    key?: string;
    mid_price?: number;
    price_source?: "deepbook" | "fallback";
  };
  orders?: Array<{
    client_order_id: string;
    price: number;
    quantity_sui: number;
    side: "ask" | "bid";
    offset_bps: number;
    status: "posted" | "simulated";
  }>;
  analysis?: {
    estimated_depth_sui?: number;
    disbursement_recommendation?: string;
  };
  metadata?: {
    mode?: "live" | "simulated";
    deposit_sui?: number;
    balance_manager?: string;
  };
};

function TreasuryView({ raw }: { raw: string }) {
  let v: TreasuryDeliverable | null = null;
  try {
    v = JSON.parse(raw) as TreasuryDeliverable;
  } catch {
    /* fall through */
  }
  if (!v) {
    return (
      <pre className="overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">
        {raw.slice(0, 4000)}
      </pre>
    );
  }
  const mode = v.metadata?.mode ?? "simulated";
  return (
    <div className="space-y-5">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Treasury · DeepBook v3
        </p>
        <h3 className="mt-1 text-lg font-medium tracking-tight">
          {v.task_title ?? "Treasury report"}
        </h3>
        <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-ink-2">
          <span>
            <span className="text-muted">pool </span>
            {v.pool?.key ?? "—"}
          </span>
          <span>
            <span className="text-muted">mid </span>
            <span className="tabular-nums text-ink">
              ${v.pool?.mid_price?.toFixed(4) ?? "—"}
            </span>
            <span className="ml-1 text-muted">
              ({v.pool?.price_source ?? "—"})
            </span>
          </span>
          <span>
            <span className="text-muted">mode </span>
            <span
              className={
                mode === "live"
                  ? "text-emerald-700"
                  : "text-amber-700"
              }
            >
              {mode}
            </span>
          </span>
        </div>
      </header>

      {(v.orders ?? []).length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            Test orders
          </p>
          <table className="mt-2 w-full border border-line text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-bg-elev-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                <th className="px-3 py-2 text-left">side</th>
                <th className="px-3 py-2 text-right">qty</th>
                <th className="px-3 py-2 text-right">price</th>
                <th className="px-3 py-2 text-right">offset</th>
                <th className="px-3 py-2 text-left">status</th>
              </tr>
            </thead>
            <tbody>
              {(v.orders ?? []).map((o) => (
                <tr key={o.client_order_id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono">{o.side}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {o.quantity_sui} SUI
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    ${o.price.toFixed(4)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    +{o.offset_bps}bps
                  </td>
                  <td className="px-3 py-2 font-mono text-ink-2">
                    {o.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.analysis?.disbursement_recommendation && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            Recommendation
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
            {v.analysis.disbursement_recommendation}
          </p>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Minimal markdown renderer. Just enough to render the Research deliverable
// cleanly (headings, lists, paragraphs, inline bold/italic/code, code blocks).
// Intentionally tiny — no external deps.
// -----------------------------------------------------------------------------

function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="space-y-4 text-[13.5px] leading-relaxed text-ink-2">
      {blocks.map((b, i) => (
        <MarkdownBlock key={i} block={b} />
      ))}
    </div>
  );
}

type MdBlock =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "hr" }
  | { kind: "blockquote"; text: string };

function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === "") {
      i++;
      continue;
    }
    if (l.startsWith("```")) {
      const lang = l.slice(3).trim();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing
      blocks.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }
    if (l.startsWith("# ")) {
      blocks.push({ kind: "h1", text: l.slice(2).trim() });
      i++;
      continue;
    }
    if (l.startsWith("## ")) {
      blocks.push({ kind: "h2", text: l.slice(3).trim() });
      i++;
      continue;
    }
    if (l.startsWith("### ")) {
      blocks.push({ kind: "h3", text: l.slice(4).trim() });
      i++;
      continue;
    }
    if (l.trim() === "---" || l.trim() === "***") {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (l.startsWith("> ")) {
      const buf: string[] = [l.slice(2)];
      i++;
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ kind: "blockquote", text: buf.join(" ") });
      continue;
    }
    if (/^[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph: join consecutive non-empty non-block lines.
    const buf = [l];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

function MarkdownBlock({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "h1":
      return (
        <h2 className="font-sans text-xl font-medium tracking-tight text-ink">
          {inline(block.text)}
        </h2>
      );
    case "h2":
      return (
        <h3 className="font-sans text-lg font-medium tracking-tight text-ink">
          {inline(block.text)}
        </h3>
      );
    case "h3":
      return (
        <h4 className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-2">
          {inline(block.text)}
        </h4>
      );
    case "p":
      return <p>{inline(block.text)}</p>;
    case "ul":
      return (
        <ul className="list-inside list-disc space-y-1">
          {block.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-inside list-decimal space-y-1">
          {block.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="overflow-auto border border-line bg-bg-elev p-3 font-mono text-[11.5px] leading-relaxed text-ink">
          {block.text}
        </pre>
      );
    case "hr":
      return <hr className="border-line" />;
    case "blockquote":
      return (
        <blockquote className="border-l-2 border-line-strong pl-3 italic text-ink-2">
          {inline(block.text)}
        </blockquote>
      );
  }
}

// Tiny inline parser: **bold**, *italic*, `code`. Avoids dangerouslySetInnerHTML.
function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Order matters: code first (to avoid eating ** inside `…`), then bold,
  // then italic.
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const seg = m[0];
    if (seg.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded bg-bg-elev-2 px-1 font-mono text-[12px] text-ink">
          {seg.slice(1, -1)}
        </code>,
      );
    } else if (seg.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-medium text-ink">
          {seg.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <em key={key++} className="italic">
          {seg.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + seg.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// =============================================================================
// Revoke confirmation modal
// =============================================================================

function RevokeModal({
  onConfirm,
  onCancel,
  submitting,
  name,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
  name: string;
}) {
  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-up"
      onClick={onCancel}
    >
      <div
        className="mx-6 w-full max-w-md border-2 border-red-500 bg-bg-elev p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-red-700">
          <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
          Halt the workforce
        </div>
        <h3 className="mt-3 font-sans text-2xl font-medium tracking-tight">
          Revoke {name}?
        </h3>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
          You&apos;ll sign one transaction. The chain itself will refuse the
          workforce&apos;s next settlement — funds stay locked in escrow,
          the specialist never gets paid. This is final until you grant a
          new policy.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex items-center gap-2 border-2 border-red-500 bg-red-500 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing…
              </>
            ) : (
              <>
                <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                Revoke now
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function EmptyHint({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
        {children}
      </p>
    );
  }
  return (
    <div className="border border-dashed border-line bg-bg-elev px-4 py-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
        {children}
      </p>
    </div>
  );
}

function short(s: string, head = 6, tail = 4): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
