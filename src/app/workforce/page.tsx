"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, Loader2 } from "lucide-react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { BRIEF_PACKAGE_ID, explorerUrl } from "@/lib/brief-client";
import {
  BRIEF_OPERATOR_ADDRESS,
  WORKFORCE_TEMPLATES,
  templateById,
  buildActivateTx,
  dispatchMission,
  plannerCliCommand,
  useAgentRegistration,
  useDeliverable,
  usePolicy,
  useResolvedPolicyId,
  useTasksForPolicy,
  type TaskStatus,
  type WorkforceTask,
  type WorkforceTemplate,
} from "@/lib/workforce-client";

// ---------------------------------------------------------------------------
// /workforce — Hire Wizard + post-grant console
//
// Day 8 scaffold of the locked plan. Three stages — Template → Configure →
// Activate — drive an OperatorPolicy create tx through dApp Kit. After
// the grant lands, we show the policy id, a "Run mission" form, and the
// equivalent CLI command for users who want to drive the planner manually
// during single-wallet Wk1 demo runs.
//
// The Activity Stream (Day 9) and Agent profile cards (Day 10) plug in
// where we currently render the policy summary stub.
// ---------------------------------------------------------------------------

const DEFAULT_TARGET_PACKAGE_ID = BRIEF_PACKAGE_ID;

type WizardStage = "template" | "configure" | "activate";

type ActivationResult = {
  policyId: string;
  txDigest: string;
  templateId: string;
  name: string;
  budgetSui: number;
  allowedVenues: string[];
};

export default function WorkforcePage() {
  const account = useCurrentAccount();

  if (!account) {
    return <DisconnectedGate />;
  }
  return <Connected address={account.address} />;
}

// ---------------------------------------------------------------------------
// Disconnected gate
// ---------------------------------------------------------------------------

function DisconnectedGate() {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <Header />
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-32 sm:px-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Workforce · console
        </p>
        <h1 className="mt-4 font-sans text-4xl font-medium tracking-tightest sm:text-5xl">
          Hire a workforce.
        </h1>
        <p className="mt-6 max-w-prose text-lg leading-relaxed text-ink-2">
          A Planner agent decomposes your mission into sub-tasks and posts
          each on chain with escrowed bounty. Specialist agents — Research,
          Treasury — accept the assignments, deliver, and get paid
          atomically with a policy check. Revoke the policy, and the chain
          itself blocks the next payment.
        </p>
        <div className="mt-10 flex items-center gap-3">
          <ConnectButton connectText="Connect wallet" />
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
          >
            ← Back to landing
          </Link>
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Connected — driven by stage state
// ---------------------------------------------------------------------------

function Connected({ address }: { address: string }) {
  const [activation, setActivation] = useState<ActivationResult | null>(null);

  if (activation) {
    return (
      <main className="min-h-screen bg-bg text-ink">
        <Header connected={address} />
        <PostActivationConsole activation={activation} onReset={() => setActivation(null)} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-ink">
      <Header connected={address} />
      <HireWizard address={address} onActivated={setActivation} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hire Wizard — Template → Configure → Activate
// ---------------------------------------------------------------------------

function HireWizard({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}) {
  const [stage, setStage] = useState<WizardStage>("template");
  const [templateId, setTemplateId] = useState<string>(WORKFORCE_TEMPLATES[0].id);
  const template = useMemo(() => templateById(templateId)!, [templateId]);

  const [name, setName] = useState(template.defaults.name);
  const [mission, setMission] = useState("");
  const [budgetSui, setBudgetSui] = useState(template.defaults.budgetSui);
  const [allowedVenues, setAllowedVenues] = useState<string[]>(template.defaults.allowedVenues);
  const [expiryHours, setExpiryHours] = useState(template.defaults.expiryHours);
  const [riskTolerance, setRiskTolerance] = useState<"low" | "medium" | "high">(template.defaults.riskTolerance);

  useEffect(() => {
    setName(template.defaults.name);
    setBudgetSui(template.defaults.budgetSui);
    setAllowedVenues(template.defaults.allowedVenues);
    setExpiryHours(template.defaults.expiryHours);
    setRiskTolerance(template.defaults.riskTolerance);
  }, [templateId, template]);

  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [activateError, setActivateError] = useState<string | null>(null);

  function handleActivate() {
    setActivateError(null);
    // The OWNER of the policy is the connected wallet (signer). The AGENT
    // is the Planner address from env — that's the wallet the
    // planner-service signs as, and what record_spend checks against.
    let tx;
    try {
      tx = buildActivateTx({
        packageId: BRIEF_PACKAGE_ID,
        // agentAddress omitted on purpose → falls back to BRIEF_OPERATOR_ADDRESS.
        templateId,
        name,
        budgetSui,
        allowedVenues,
        expiryHours,
        riskTolerance,
      });
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : String(e));
      return;
    }
    signAndExecute(
      { transaction: tx },
      {
        onSuccess: (res) => {
          // We don't have the new policy object id here without re-fetching
          // tx effects via the client. For the scaffold we surface the
          // tx digest; the post-activation console refetches the policy
          // from getOwnedObjects shortly.
          onActivated({
            policyId: "(resolving…)",
            txDigest: res.digest,
            templateId,
            name,
            budgetSui,
            allowedVenues,
          });
        },
        onError: (e) => {
          setActivateError(e instanceof Error ? e.message : String(e));
        },
      },
    );
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-12 sm:px-10 sm:py-16">
      <StageCrumb stage={stage} />

      {stage === "template" && (
        <TemplateStage
          selectedId={templateId}
          onSelect={setTemplateId}
          onNext={() => setStage("configure")}
        />
      )}

      {stage === "configure" && (
        <ConfigureStage
          template={template}
          name={name}
          setName={setName}
          mission={mission}
          setMission={setMission}
          budgetSui={budgetSui}
          setBudgetSui={setBudgetSui}
          allowedVenues={allowedVenues}
          setAllowedVenues={setAllowedVenues}
          expiryHours={expiryHours}
          setExpiryHours={setExpiryHours}
          riskTolerance={riskTolerance}
          setRiskTolerance={setRiskTolerance}
          onBack={() => setStage("template")}
          onNext={() => setStage("activate")}
        />
      )}

      {stage === "activate" && (
        <ActivateStage
          template={template}
          name={name}
          mission={mission}
          budgetSui={budgetSui}
          allowedVenues={allowedVenues}
          expiryHours={expiryHours}
          isPending={isPending}
          error={activateError}
          onBack={() => setStage("configure")}
          onSign={handleActivate}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stage crumb
// ---------------------------------------------------------------------------

function StageCrumb({ stage }: { stage: WizardStage }) {
  const stages: { id: WizardStage; label: string }[] = [
    { id: "template", label: "Template" },
    { id: "configure", label: "Configure" },
    { id: "activate", label: "Activate" },
  ];
  const activeIdx = stages.findIndex((s) => s.id === stage);
  return (
    <div className="mb-12 flex items-center gap-3">
      {stages.map((s, i) => {
        const isActive = s.id === stage;
        const isDone = i < activeIdx;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <span
              className={[
                "inline-flex h-6 items-center gap-2 border px-3 font-mono text-[10px] uppercase tracking-[0.28em]",
                isActive
                  ? "border-ink text-ink"
                  : isDone
                    ? "border-ink/40 text-ink-2"
                    : "border-line text-muted",
              ].join(" ")}
            >
              {isDone && <Check className="h-3 w-3" strokeWidth={2} />}
              {s.label}
            </span>
            {i < stages.length - 1 && (
              <span className="h-px w-6 bg-line" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — Template
// ---------------------------------------------------------------------------

function TemplateStage({
  selectedId,
  onSelect,
  onNext,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Stage 1 · template
      </p>
      <h2 className="mt-3 font-sans text-3xl font-medium tracking-tighter">
        Pick a workforce shape.
      </h2>
      <p className="mt-3 max-w-prose text-ink-2">
        Each template presets the policy&apos;s budget envelope, the
        capabilities the workforce includes, the expiry, and the risk
        profile. You can adjust everything in the next stage.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {WORKFORCE_TEMPLATES.map((t) => {
          const selected = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={[
                "flex flex-col items-start gap-3 border-2 bg-bg-elev p-5 text-left transition-shadow",
                selected ? "border-ink shadow-sm" : "border-line hover:border-line-strong",
              ].join(" ")}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
                {t.id}
              </p>
              <p className="text-xl font-medium tracking-tight">{t.label}</p>
              <p className="text-sm leading-relaxed text-ink-2">{t.blurb}</p>
              <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2">
                <Pill>{t.defaults.budgetSui} SUI</Pill>
                <Pill>{t.defaults.allowedVenues.length} caps</Pill>
                <Pill>{t.defaults.expiryHours}h</Pill>
                <Pill>{t.defaults.riskTolerance}</Pill>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-10 flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2"
        >
          Configure
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-line px-2 py-0.5">{children}</span>
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — Configure
// ---------------------------------------------------------------------------

const ALL_CAPABILITIES = ["research", "audit", "treasury"];

function ConfigureStage(props: {
  template: WorkforceTemplate;
  name: string;
  setName: (v: string) => void;
  mission: string;
  setMission: (v: string) => void;
  budgetSui: number;
  setBudgetSui: (v: number) => void;
  allowedVenues: string[];
  setAllowedVenues: (v: string[]) => void;
  expiryHours: number;
  setExpiryHours: (v: number) => void;
  riskTolerance: "low" | "medium" | "high";
  setRiskTolerance: (v: "low" | "medium" | "high") => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const {
    template,
    name,
    setName,
    mission,
    setMission,
    budgetSui,
    setBudgetSui,
    allowedVenues,
    setAllowedVenues,
    expiryHours,
    setExpiryHours,
    riskTolerance,
    setRiskTolerance,
    onBack,
    onNext,
  } = props;

  const toggleCap = (cap: string) => {
    if (allowedVenues.includes(cap)) {
      setAllowedVenues(allowedVenues.filter((v) => v !== cap));
    } else {
      setAllowedVenues([...allowedVenues, cap]);
    }
  };

  const canProceed = name.trim().length > 0 && allowedVenues.length > 0;

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Stage 2 · configure
      </p>
      <h2 className="mt-3 font-sans text-3xl font-medium tracking-tighter">
        Set the envelope.
      </h2>
      <p className="mt-3 max-w-prose text-ink-2">
        Every constraint here is enforced on chain when the Planner posts
        sub-tasks and when you (or the auto-approve threshold) settle
        their deliverables.
      </p>

      <div className="mt-8 space-y-6 border border-line bg-bg-elev p-6">
        <Field label="Workforce name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-line bg-bg px-3 py-2 text-base outline-none focus:border-ink"
            maxLength={64}
          />
        </Field>

        <Field
          label="Mission objective"
          help="The brief you'll pass the Planner. Surfaces on every sub-task. Stored off chain; the envelope below is what the chain enforces."
        >
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            placeholder={template.defaults.missionPlaceholder}
            rows={3}
            className="w-full resize-none border border-line bg-bg px-3 py-2 text-base outline-none focus:border-ink"
            maxLength={1600}
          />
        </Field>

        <Field
          label={
            <span>
              Budget cap{" "}
              <span className="font-mono text-ink tabular-nums">
                {budgetSui.toFixed(2)} SUI
              </span>
            </span>
          }
        >
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={budgetSui}
            onChange={(e) => setBudgetSui(Number(e.target.value))}
            className="w-full accent-ink"
          />
        </Field>

        <Field label="Allowed capabilities">
          <div className="flex flex-wrap gap-2">
            {ALL_CAPABILITIES.map((cap) => {
              const on = allowedVenues.includes(cap);
              return (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCap(cap)}
                  className={[
                    "border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
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
                    "border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
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
                    "border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
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

      <div className="mt-10 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-muted"
        >
          Review & activate
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: React.ReactNode;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2">
        {label}
      </p>
      {children}
      {help && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{help}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — Activate
// ---------------------------------------------------------------------------

function ActivateStage(props: {
  template: WorkforceTemplate;
  name: string;
  mission: string;
  budgetSui: number;
  allowedVenues: string[];
  expiryHours: number;
  isPending: boolean;
  error: string | null;
  onBack: () => void;
  onSign: () => void;
}) {
  const { template, name, mission, budgetSui, allowedVenues, expiryHours, isPending, error, onBack, onSign } = props;
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Stage 3 · activate
      </p>
      <h2 className="mt-3 font-sans text-3xl font-medium tracking-tighter">
        Authorize {name}.
      </h2>

      <div className="mt-8 border border-line bg-bg-elev p-6">
        {mission && (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2">
              Mission
            </p>
            <p className="mt-2 border-l-2 border-line-strong pl-4 italic text-ink-2">
              {mission}
            </p>
            <div className="my-4 h-px bg-line" />
          </>
        )}
        <p className="leading-relaxed">
          <span className="font-medium text-ink">{name}</span> can spend up
          to{" "}
          <span className="font-mono tabular-nums">{budgetSui.toFixed(2)} SUI</span>{" "}
          over the next{" "}
          <span className="font-mono">{expiryHours}h</span> across{" "}
          <span className="font-mono">[{allowedVenues.join(", ")}]</span>. Each
          sub-task it posts is escrowed and only released when the
          deliverable is approved.{" "}
          <span className="text-muted">
            (Template: {template.label}.)
          </span>
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-2">
          Planner agent ·{" "}
          <span className="text-ink">
            {BRIEF_OPERATOR_ADDRESS.slice(0, 10)}…
            {BRIEF_OPERATOR_ADDRESS.slice(-6)}
          </span>
        </p>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          You&apos;re signing a single transaction that creates a Move{" "}
          <span className="font-mono">OperatorPolicy</span> on chain — you
          are the OWNER, the Planner above is the bound AGENT. You can
          revoke at any time with a single counter-signature; the chain
          itself will block any further payment.
        </p>
      </div>

      <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.32em] text-muted">
        the AI is not trusted · the policy is
      </p>

      {error && (
        <p className="mt-6 border border-red-300 bg-red-50 p-3 font-mono text-[12px] text-red-700">
          {error.slice(0, 240)}
        </p>
      )}

      <div className="mt-10 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onSign}
          disabled={isPending}
          className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Signing…
            </>
          ) : (
            <>
              Activate workforce
              <span aria-hidden>→</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-activation console
// ---------------------------------------------------------------------------

function PostActivationConsole({
  activation,
  onReset,
}: {
  activation: ActivationResult;
  onReset: () => void;
}) {
  // Resolve the actual policy id from the grant tx digest.
  const resolvedPolicyId = useResolvedPolicyId(activation.txDigest);
  const effectivePolicyId = resolvedPolicyId ?? null;

  // Live policy + tasks polling. Both are no-ops until the policy id is
  // available, so we can render the form skeleton immediately.
  const { policy } = usePolicy(effectivePolicyId);
  const { tasks, loading: tasksLoading } = useTasksForPolicy(effectivePolicyId);

  const [mission, setMission] = useState("");
  const [targetPackageId, setTargetPackageId] = useState(DEFAULT_TARGET_PACKAGE_ID);
  const [dispatchState, setDispatchState] = useState<
    "idle" | "sending" | "ok" | "err"
  >("idle");
  const [dispatchErr, setDispatchErr] = useState<string | null>(null);

  async function handleDispatch() {
    setDispatchErr(null);
    if (!effectivePolicyId) {
      setDispatchErr("Policy id is still resolving from the grant tx — wait a beat");
      return;
    }
    if (mission.trim().length === 0) {
      setDispatchErr("Mission must not be empty");
      return;
    }
    setDispatchState("sending");
    try {
      await dispatchMission({
        policyId: effectivePolicyId,
        mission,
        targetPackageId: targetPackageId || undefined,
      });
      setDispatchState("ok");
    } catch (e) {
      setDispatchErr(e instanceof Error ? e.message : String(e));
      setDispatchState("err");
    }
  }

  const cliCommand = plannerCliCommand({
    policyId: effectivePolicyId ?? "<resolving…>",
    mission: mission || "(your mission here)",
    targetPackageId: targetPackageId || undefined,
  });

  const policyDisplay = effectivePolicyId ?? "(resolving…)";
  const budgetRemainingMist = policy
    ? policy.budgetCap - policy.spent
    : null;
  const budgetRemainingSui = budgetRemainingMist
    ? Number(budgetRemainingMist) / 1e9
    : null;

  return (
    <section className="mx-auto max-w-4xl px-6 py-12 sm:px-10 sm:py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Workforce · live
      </p>
      <h1 className="mt-3 font-sans text-3xl font-medium tracking-tighter">
        {activation.name} is active.
      </h1>

      <div className="mt-8 border-2 border-ink bg-bg-elev p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryRow label="Template">{activation.templateId}</SummaryRow>
          <SummaryRow label="Budget">
            <span className="font-mono tabular-nums">
              {budgetRemainingSui !== null
                ? `${budgetRemainingSui.toFixed(3)} / ${activation.budgetSui.toFixed(2)} SUI remaining`
                : `${activation.budgetSui.toFixed(2)} SUI`}
            </span>
          </SummaryRow>
          <SummaryRow label="Capabilities">
            <span className="font-mono">[{activation.allowedVenues.join(", ")}]</span>
          </SummaryRow>
          <SummaryRow label="Policy id">
            {effectivePolicyId ? (
              <CopyableMono value={effectivePolicyId} />
            ) : (
              <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                {policyDisplay}
              </span>
            )}
          </SummaryRow>
          <SummaryRow label="Grant tx">
            <a
              href={explorerUrl("txblock", activation.txDigest)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-ink underline-offset-4 hover:underline"
            >
              {short(activation.txDigest, 6, 6)}
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
            </a>
          </SummaryRow>
          {policy?.revoked && (
            <SummaryRow label="Status">
              <span className="font-mono text-red-700">
                REVOKED · approvals will abort on chain
              </span>
            </SummaryRow>
          )}
        </div>
      </div>

      <div className="mt-8 border border-line bg-bg-elev p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Dispatch mission
        </p>
        <h2 className="mt-3 font-sans text-xl font-medium tracking-tight">
          Tell the Planner what to do.
        </h2>
        <p className="mt-2 text-[13px] text-ink-2">
          The Planner agent will decompose this mission into sub-tasks and
          post each on chain with policy-escrowed bounty. Specialist agents
          (Research, Treasury) accept their assignments and deliver.
        </p>

        <div className="mt-5 space-y-4">
          <Field label="Mission">
            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="Evaluate this Move contract for a $50,000 DAO grant…"
              rows={4}
              className="w-full resize-none border border-line bg-bg px-3 py-2 text-base outline-none focus:border-ink"
              maxLength={1600}
            />
          </Field>
          <Field label="Target package id (optional)">
            <input
              type="text"
              value={targetPackageId}
              onChange={(e) => setTargetPackageId(e.target.value)}
              className="w-full border border-line bg-bg px-3 py-2 font-mono text-[12px] outline-none focus:border-ink"
              placeholder="0x…"
            />
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            {dispatchState === "ok" ? "Queued · planner-service will run" : ""}
            {dispatchState === "sending" ? "Sending…" : ""}
            {dispatchState === "err" ? "Failed · paste CLI fallback below" : ""}
          </p>
          <button
            type="button"
            onClick={handleDispatch}
            disabled={dispatchState === "sending"}
            className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-5 py-2 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {dispatchState === "sending" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending
              </>
            ) : (
              <>
                Dispatch <span aria-hidden>→</span>
              </>
            )}
          </button>
        </div>
        {dispatchErr && (
          <p className="mt-3 border border-red-200 bg-red-50 p-3 font-mono text-[12px] text-red-700">
            {dispatchErr.slice(0, 240)}
          </p>
        )}
      </div>

      {/* Activity Stream — live polled tasks for this policy */}
      <ActivityStream tasks={tasks} loading={tasksLoading} hasPolicy={!!effectivePolicyId} />

      <details className="mt-8 border border-line bg-bg-elev">
        <summary className="cursor-pointer px-6 py-4 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2">
          ▶ Run from CLI instead
        </summary>
        <div className="border-t border-line px-6 py-4">
          <p className="text-[13px] text-muted">
            Paste this in the project root. The agents:all script must be
            running ({" "}
            <span className="font-mono">npm run agents:all</span>).
          </p>
          <pre className="mt-3 overflow-x-auto border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-ink">
            {cliCommand}
          </pre>
          <CopyableMono value={cliCommand} hideText />
        </div>
      </details>

      <div className="mt-12">
        <button
          type="button"
          onClick={onReset}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
        >
          ← Grant another workforce
        </button>
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 sm:border-t-0 sm:py-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-[14px]">{children}</p>
    </div>
  );
}

function CopyableMono({ value, hideText }: { value: string; hideText?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      {!hideText && (
        <span className="font-mono text-[12px] text-ink">{short(value, 8, 8)}</span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:text-ink"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" strokeWidth={2} />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" strokeWidth={1.5} />
            Copy
          </>
        )}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Activity Stream — live polled task list for the active policy
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<TaskStatus, { label: string; tone: string }> = {
  open: { label: "OPEN", tone: "border-line text-muted" },
  accepted: { label: "ACCEPTED", tone: "border-amber-400 text-amber-700" },
  delivered: { label: "DELIVERED", tone: "border-emerald-500 text-emerald-700" },
  approved: { label: "APPROVED", tone: "border-ink bg-ink text-bg" },
  expired: { label: "EXPIRED", tone: "border-red-300 text-red-700" },
  unknown: { label: "—", tone: "border-line text-muted" },
};

function ActivityStream({
  tasks,
  loading,
  hasPolicy,
}: {
  tasks: WorkforceTask[];
  loading: boolean;
  hasPolicy: boolean;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Activity · {tasks.length}
        </p>
        {hasPolicy && (
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            {loading && tasks.length === 0 ? "polling…" : "polling · 3s"}
          </p>
        )}
      </div>
      <div className="mt-4 border border-line bg-bg-elev">
        {!hasPolicy ? (
          <p className="px-6 py-6 text-center font-mono text-[12px] uppercase tracking-[0.16em] text-muted">
            Waiting for policy id to resolve…
          </p>
        ) : tasks.length === 0 ? (
          <p className="px-6 py-6 text-center font-mono text-[12px] uppercase tracking-[0.16em] text-muted">
            No tasks posted yet — dispatch a mission above to start the
            workforce.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TaskRow({ task }: { task: WorkforceTask }) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState<{
    ok?: boolean;
    txDigest?: string;
    abortCode?: number;
    abortConst?: string;
    abortModule?: string;
    abortFn?: string;
    error?: string;
  } | null>(null);
  const tone = STATUS_TONE[task.status];
  const bountySui = Number(task.bountyMist) / 1e9;
  const ageMs = Date.now() - Number(task.postedAtMs);

  async function handleApprove() {
    setApproving(true);
    setApproveResult(null);
    try {
      const res = await fetch("/api/workforce/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: task.id,
          policy_id: task.parentPolicy,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        txDigest?: string;
        abortCode?: number;
        abortConst?: string;
        abortModule?: string;
        abortFn?: string;
        error?: string;
      };
      setApproveResult(json);
    } catch (e) {
      setApproveResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setApproving(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left hover:bg-bg/50"
      >
        <div className="flex min-w-0 items-center gap-4">
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
          <span className="hidden font-mono text-[10px] text-muted sm:inline">
            {formatRelativeShort(ageMs)}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-line bg-bg/40 px-6 py-4 text-[12.5px] leading-relaxed">
          <DetailRow label="Task id">
            <a
              href={explorerUrl("object", task.id)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-ink underline-offset-4 hover:underline"
            >
              {short(task.id, 8, 8)}
            </a>
          </DetailRow>
          <DetailRow label="Posted tx">
            <a
              href={explorerUrl("txblock", task.postedTxDigest)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-ink underline-offset-4 hover:underline"
            >
              {short(task.postedTxDigest, 8, 8)}
            </a>
          </DetailRow>
          {task.deliverableId && (
            <DetailRow label="Deliverable">
              <a
                href={explorerUrl("object", task.deliverableId)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-ink underline-offset-4 hover:underline"
              >
                {short(task.deliverableId, 8, 8)}
              </a>
            </DetailRow>
          )}

          <AgentProfileCard address={task.assignedTo} />

          {task.deliverableId && (
            <DeliverablePreview deliverableId={task.deliverableId} />
          )}

          {task.specBlob && (
            <DetailRow label="Spec">
              <pre className="mt-1 max-h-40 overflow-auto border border-line bg-bg p-2 font-mono text-[11px]">
                {task.specBlob.slice(0, 800)}
                {task.specBlob.length > 800 ? "…" : ""}
              </pre>
            </DetailRow>
          )}
          {task.status === "delivered" && !approveResult?.ok && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleApprove}
                disabled={approving}
                className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Approving
                  </>
                ) : (
                  <>
                    Approve & pay
                    <Check className="h-3 w-3" strokeWidth={2} />
                  </>
                )}
              </button>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                planner signs · {bountySui.toFixed(2)} SUI to{" "}
                {short(task.assignedTo, 6, 4)}
              </span>
            </div>
          )}
          {approveResult?.ok && (
            <p className="mt-4 inline-flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-mono text-[12px] text-emerald-800">
              <Check className="h-3 w-3" strokeWidth={2} />
              Paid · tx{" "}
              <a
                href={
                  approveResult.txDigest
                    ? explorerUrl("txblock", approveResult.txDigest)
                    : "#"
                }
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                {approveResult.txDigest
                  ? short(approveResult.txDigest, 6, 6)
                  : "—"}
              </a>
            </p>
          )}
          {approveResult && !approveResult.ok && (
            <p className="mt-4 border border-red-300 bg-red-50 p-3 font-mono text-[12px] text-red-700">
              {approveResult.abortCode !== undefined ? (
                <>
                  ABORTED on chain — {approveResult.abortModule ?? "?"}::
                  {approveResult.abortFn ?? "?"} code {approveResult.abortCode}
                  {approveResult.abortConst ? ` (${approveResult.abortConst})` : ""}
                </>
              ) : (
                <>{approveResult.error ?? "approval failed"}</>
              )}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent profile card — inline pull of the specialist's AgentRegistration
// ---------------------------------------------------------------------------

function AgentProfileCard({ address }: { address: string }) {
  const { profile, loading } = useAgentRegistration(address);
  return (
    <div className="mt-3 border border-line bg-bg p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
        Assigned specialist
      </p>
      <div className="mt-2 grid grid-cols-[110px_1fr] gap-3 text-[12.5px]">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Address
        </span>
        <span className="font-mono text-ink">{short(address, 10, 10)}</span>
      </div>
      {loading && !profile && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Loading registration…
        </p>
      )}
      {!loading && !profile && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          No on-chain registration found for this address.
        </p>
      )}
      {profile && (
        <>
          <div className="mt-2 grid grid-cols-[110px_1fr] gap-3 text-[12.5px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Display name
            </span>
            <span className="text-ink">{profile.displayName || "—"}</span>
          </div>
          <div className="mt-1 grid grid-cols-[110px_1fr] gap-3 text-[12.5px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Capabilities
            </span>
            <span className="font-mono">[{profile.capabilities.join(", ")}]</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
            <ProfileStat label="completed" value={String(profile.completedTasks)} />
            <ProfileStat label="reputation" value={String(profile.reputationScore)} />
            <ProfileStat
              label="total paid"
              value={`${(Number(profile.totalPaidMist) / 1e9).toFixed(3)} SUI`}
            />
            <ProfileStat
              label="base price"
              value={`${(Number(profile.basePricePerCallMist) / 1e9).toFixed(2)} SUI/call`}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="border border-line px-2 py-0.5 font-mono">
      <span className="text-muted">{label}: </span>
      <span className="text-ink tabular-nums">{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Deliverable preview — inline render of the on-chain / Walrus content
// ---------------------------------------------------------------------------

function DeliverablePreview({ deliverableId }: { deliverableId: string }) {
  const d = useDeliverable(deliverableId);
  return (
    <div className="mt-3 border border-line bg-bg p-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Deliverable {d.bodyKind ? `· ${d.bodyKind}` : ""}
          {d.walrusBlobId && (
            <>
              {" · "}
              <a
                href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${d.walrusBlobId}`}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-ink hover:underline"
              >
                walrus blob
              </a>
            </>
          )}
        </p>
      </div>
      {d.loading && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Loading content…
        </p>
      )}
      {!d.loading && !d.body && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          No inline / Walrus body found yet (propagation can take ~15s).
        </p>
      )}
      {d.body && (
        <pre className="mt-2 max-h-80 overflow-auto border border-line bg-bg-elev p-3 font-mono text-[11.5px] leading-relaxed">
          {d.body.length > 6000 ? d.body.slice(0, 6000) + "\n\n… (truncated)" : d.body}
        </pre>
      )}
    </div>
  );
}

function formatRelativeShort(ms: number): string {
  if (ms < 1000) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function short(s: string, head = 6, tail = 4): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
