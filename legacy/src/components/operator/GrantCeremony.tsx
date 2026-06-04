"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { BRIEF_PACKAGE_ID } from "@/lib/brief-client";
import {
  BRIEF_OPERATOR_ADDRESS,
  buildCreatePolicyTx,
  suiToMist,
} from "@/lib/operator-policy-client";
import { CHROME } from "@/lib/operator-language";
import {
  isWalletSessionError,
  WalletSessionFix,
} from "./PersistentHeader";

/**
 * GrantCeremony — "pick a job, sign it" form.
 *
 * Four preset cards, each framed as a job-to-be-done in user language
 * ("Stake my SUI", "Make markets", etc) — with the risk band and a
 * one-sentence description of what the agent will actually do every
 * cycle. The user picks one, sees a plain-English "you're authorizing
 * …" block summarizing the commitment, and signs.
 *
 * The mechanical form fields (name, budget, venues, expiry, risk
 * tolerance, max single position) live behind an "adjust the details ▾"
 * disclosure for power users. The default config produced by each
 * preset is sensible, so the typical user never opens that drawer.
 */

type RiskBand = "low" | "medium" | "high";

type Config = {
  presetId: string;
  name: string;
  objective: string;
  budgetSui: number;
  venues: string[];
  maxConcentrationPct: number;
  expiryHours: number;
  autoApprovePct: number;
  risk: RiskBand;
};

type Preset = {
  id: string;
  numeral: string;
  title: string;
  /** One-line risk + return summary. */
  band: string;
  /** What the agent will literally do, in plain English. */
  whatItDoes: string;
  /** Insertable into the "authorizing" sentence: "to ___ with up to N SUI." */
  authorizingVerb: string;
  config: Omit<Config, "presetId">;
};

/**
 * Presets — every option here is fully wired end-to-end on testnet.
 * The agent has real integrations for:
 *
 *   • SuiSystem  →  `0x3::sui_system::request_add_stake` to an active validator
 *   • DeepBook   →  `place_market_order` on the testnet SUI/DBUSDC pool
 *
 * Earlier drafts included NAVI / Suilend / SpringSui in some preset venue
 * lists, but the agent has no execution path for those yet, so the
 * evaluator would silently filter them out and the operator would only
 * trade on DeepBook anyway. Removed those presets to avoid misleading
 * users; NAVI/Suilend are roadmap (see PRODUCT_STATE.md).
 */
const PRESETS: Preset[] = [
  {
    id: "sui-staking",
    numeral: "01",
    title: "Stake my SUI",
    band: "Low risk · ~4% APY",
    whatItDoes:
      "Delegate SUI to an active validator on the Sui System staking module. Rewards compound each epoch.",
    authorizingVerb: "stake your SUI with an active Sui System validator",
    config: {
      name: "Sui Validator Operator",
      objective:
        "Stake SUI with the Sui System validator set and compound rewards. Maintain validator-tier exposure only.",
      budgetSui: 5,
      venues: ["SuiSystem"],
      maxConcentrationPct: 100,
      expiryHours: 24,
      autoApprovePct: 80,
      risk: "low",
    },
  },
  {
    id: "deepbook-mm",
    numeral: "02",
    title: "Make markets on DeepBook",
    band: "Medium risk · trading fees",
    whatItDoes:
      "Provide liquidity on DeepBook's SUI/USDC order book. Earn maker fees from buyers and sellers.",
    authorizingVerb: "provide liquidity on the DeepBook SUI/USDC order book",
    config: {
      name: "DeepBook Liquidity Operator",
      objective:
        "Provide liquidity on the DeepBook SUI/USDC order book. Rotate between maker fills. Cap single-position exposure at 80% of envelope.",
      budgetSui: 5,
      venues: ["DeepBook"],
      maxConcentrationPct: 80,
      expiryHours: 24,
      autoApprovePct: 90,
      risk: "medium",
    },
  },
  {
    id: "balanced",
    numeral: "03",
    title: "Balanced · stake + trade",
    band: "Low–medium · diversified",
    whatItDoes:
      "Rotate between Sui validator staking (steady yield) and DeepBook market making (trading fees) based on live signal.",
    authorizingVerb:
      "rotate capital between Sui staking and DeepBook market making",
    config: {
      name: "Balanced Operator",
      objective:
        "Rotate between Sui System validator staking and DeepBook market making. Prefer the venue with the strongest live signal each cycle.",
      budgetSui: 5,
      venues: ["SuiSystem", "DeepBook"],
      maxConcentrationPct: 60,
      expiryHours: 24,
      autoApprovePct: 75,
      risk: "low",
    },
  },
];

const ALL_VENUES = [
  "SuiSystem",
  "DeepBook",
  "NAVI",
  "Suilend",
  "SpringSui",
  "Bucket",
];
const EXPIRY_HOURS_OPTIONS = [1, 12, 24, 72, 168];
const RISK_LEVELS: RiskBand[] = ["low", "medium", "high"];

function configFromPreset(p: Preset): Config {
  return { presetId: p.id, ...p.config };
}

function expiryLabel(h: number): string {
  if (h === 1) return "1 hour";
  if (h < 24) return `${h} hours`;
  if (h === 24) return "24 hours";
  if (h < 168) return `${h / 24} days`;
  return "7 days";
}

// ---------------------------------------------------------------------------

export function GrantCeremony({ owner: _owner }: { owner: string }) {
  const [config, setConfig] = useState<Config>(() =>
    configFromPreset(PRESETS[2]!), // default: Diversify
  );
  const [expanded, setExpanded] = useState(false);
  const [explainCycle, setExplainCycle] = useState(false);
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [error, setError] = useState<string | null>(null);

  const valid = useMemo(
    () =>
      config.name.trim().length > 0 &&
      config.venues.length > 0 &&
      config.budgetSui > 0,
    [config],
  );

  const selectedPreset = PRESETS.find((p) => p.id === config.presetId);
  const setField = <K extends keyof Config>(k: K, v: Config[K]) =>
    setConfig({ ...config, [k]: v });

  const toggleVenue = (v: string) => {
    setField(
      "venues",
      config.venues.includes(v)
        ? config.venues.filter((x) => x !== v)
        : [...config.venues, v],
    );
  };

  const submit = () => {
    if (!valid) return;
    setError(null);

    if (config.objective.trim()) {
      try {
        sessionStorage.setItem(
          "brief:pending-objective",
          JSON.stringify({
            name: config.name.trim(),
            objective: config.objective.trim(),
            stashed_at_ms: Date.now(),
          }),
        );
      } catch {
        // ignore
      }
    }

    const tx = buildCreatePolicyTx({
      packageId: BRIEF_PACKAGE_ID,
      agent: BRIEF_OPERATOR_ADDRESS,
      name: config.name.trim(),
      budgetCap: suiToMist(config.budgetSui),
      allowedVenues: config.venues,
      maxConcentrationBps: config.maxConcentrationPct * 100,
      expiresAtMs: BigInt(Date.now() + config.expiryHours * 60 * 60 * 1000),
      autoApprovePct: config.autoApprovePct,
      riskTolerance: config.risk,
    });
    signAndExecute(
      { transaction: tx },
      { onError: (e) => setError(e.message) },
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-up">
      {/* Step 1 — pick a job */}
      <p className="text-[12px] font-medium text-muted">
        Step 1 · What should the agent do?
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PRESETS.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            selected={p.id === config.presetId}
            onPick={() => setConfig(configFromPreset(p))}
          />
        ))}
      </div>

      {/* "How operators work" — micro disclosure for people who don't know
          what an agent cycle actually looks like. Hidden by default. */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setExplainCycle((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
        >
          What does the agent actually do each cycle? {explainCycle ? "▴" : "▾"}
        </button>
        {explainCycle ? <CycleExplainer /> : null}
      </div>

      <div className="my-8 h-px bg-line-strong" />
      <div className="-mt-6 mb-8 h-px bg-line-strong" />

      {/* Step 2 — the goal in plain English. This is fed to the LLM plan
          composer at grant time and becomes the operator's thesis. The
          preset above seeds the default; the user can refine here. */}
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-medium text-muted">
          Step 2 · The goal, in plain English
        </p>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-muted tabular-nums">
          {config.objective.length}/240
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-[1.55] text-ink-2">
        Hand the agent the &ldquo;why.&rdquo; Specifics help &mdash; mention
        time horizon, conditions to react to, or the trade-off you want it
        to navigate.
      </p>
      <textarea
        value={config.objective}
        onChange={(e) => setField("objective", e.target.value.slice(0, 240))}
        rows={3}
        placeholder="Earn yield on 5 SUI over 30 days, low risk. Stake unless DeepBook spreads tighten below 30 bps."
        className="mt-3 w-full resize-none rounded-2xl border border-line bg-bg-elev px-5 py-4 text-[14px] leading-[1.55] text-ink outline-none transition-colors focus:border-ink-2"
      />

      <div className="my-8 h-px bg-line-strong" />
      <div className="-mt-6 mb-8 h-px bg-line-strong" />

      {/* Step 3 — review the authorization in plain English */}
      <p className="text-[12px] font-medium text-muted">
        Step 3 · You&rsquo;re authorizing
      </p>

      <AuthorizingBlock
        config={config}
        preset={selectedPreset}
      />

      {/* Step 4 — optional tweaks behind a disclosure */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
        >
          Adjust the details {expanded ? "▴" : "▾"}
        </button>
        {expanded ? (
          <DetailsForm
            config={config}
            setField={setField}
            toggleVenue={toggleVenue}
          />
        ) : null}
      </div>

      <div className="my-8 h-px bg-line-strong" />
      <div className="-mt-6 mb-2 h-px bg-line-strong" />

      {/* Sign */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!valid || isPending}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              Signing to Sui
            </>
          ) : (
            <>
              Sign &amp; activate
              <span aria-hidden>→</span>
            </>
          )}
        </button>
        {!valid ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            name, budget, and at least one venue required
          </p>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            one wallet signature · revocable at any moment
          </p>
        )}
      </div>

      {error ? (
        isWalletSessionError(error) ? (
          <div className="mt-5">
            <WalletSessionFix
              message={error}
              onCleared={() => setError(null)}
            />
          </div>
        ) : (
          <p className="mt-4 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-red-700">
            {error}
          </p>
        )
      ) : null}

      <p className="mt-8 text-center font-mono text-[9.5px] uppercase tracking-[0.32em] text-muted">
        {CHROME.philosophy}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset card — informative, scannable, picks itself on click.
// ---------------------------------------------------------------------------

function PresetCard({
  preset,
  selected,
  onPick,
}: {
  preset: Preset;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`group flex flex-col gap-3 rounded-2xl border bg-bg-elev p-5 text-left transition-all ${
        selected
          ? "border-accent ring-2 ring-accent/15"
          : "border-line hover:border-line-strong"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`font-mono text-[11px] tabular-nums ${
            selected ? "text-accent" : "text-muted"
          }`}
        >
          {preset.numeral}
        </span>
        <span className="text-[11px] text-muted">{preset.band}</span>
      </div>

      <p
        className={`text-[18px] font-semibold leading-[1.2] tracking-tight ${
          selected ? "text-ink" : "text-ink-2"
        }`}
      >
        {preset.title}
      </p>

      <p className="text-[13px] leading-[1.55] text-ink-2">
        {preset.whatItDoes}
      </p>

      <div className="mt-1 flex items-baseline justify-between">
        <p className="text-[11.5px] tabular-nums text-muted">
          {preset.config.budgetSui} SUI · {expiryLabel(preset.config.expiryHours)}
        </p>
        <p
          className={`text-[12px] font-medium ${
            selected ? "text-accent" : "text-muted"
          }`}
        >
          {selected ? "Selected" : "Select →"}
        </p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Authorizing block — a single readable sentence + a slim metadata strip.
// ---------------------------------------------------------------------------

function AuthorizingBlock({
  config,
  preset,
}: {
  config: Config;
  preset: Preset | undefined;
}) {
  const verb = preset?.authorizingVerb ?? "operate within the budget";
  return (
    <div className="mt-3 rounded-2xl border border-line bg-bg-elev p-5 sm:p-6">
      <p className="text-[15px] leading-[1.65] text-ink-2 sm:text-[16px]">
        An AI agent named{" "}
        <span className="font-medium text-ink">{config.name || "—"}</span>{" "}
        to <span className="font-medium text-ink">{verb}</span>, spending up
        to{" "}
        <span className="font-medium text-ink">{config.budgetSui} SUI</span>{" "}
        in total. The agent runs for{" "}
        <span className="font-medium text-ink">
          {expiryLabel(config.expiryHours)}
        </span>
        , then stops automatically. You can eject at any moment with one
        signature.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
        <Mini label="Budget" value={`${config.budgetSui} SUI`} />
        <Mini label="Cap per venue" value={`${config.maxConcentrationPct}%`} />
        <Mini label="Expires" value={expiryLabel(config.expiryHours)} />
        <Mini label="Risk" value={config.risk} />
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-[13px] tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CycleExplainer — three short lines describing what happens every 15s.
// ---------------------------------------------------------------------------

function CycleExplainer() {
  return (
    <div className="mt-3 border border-line bg-bg-elev p-4 sm:p-5">
      <ol className="flex flex-col gap-3 font-sans text-[13px] leading-[1.55] text-ink-2 sm:text-[13.5px]">
        <li className="flex gap-3">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            01
          </span>
          <span>
            Every 15 seconds the agent looks at the venues you allowed and
            scores them against live data (TVL, APY, audit status).
          </span>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            02
          </span>
          <span>
            It picks the best opportunity and submits one atomic Sui
            transaction — the trade plus the policy check in the same call.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            03
          </span>
          <span>
            If the trade would break any limit you set (budget, venue,
            concentration, expiry), the chain rejects the whole transaction.
            Nothing slips through.
          </span>
        </li>
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetailsForm — power-user fields tucked behind a collapse.
// ---------------------------------------------------------------------------

function DetailsForm({
  config,
  setField,
  toggleVenue,
}: {
  config: Config;
  setField: <K extends keyof Config>(k: K, v: Config[K]) => void;
  toggleVenue: (v: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-6 border border-line bg-bg-elev p-5 sm:p-6">
      <Field label="Name">
        <input
          type="text"
          value={config.name}
          onChange={(e) => setField("name", e.target.value)}
          className="w-full border border-line bg-bg px-4 py-2.5 font-mono text-[13.5px] text-ink outline-none focus:border-ink"
        />
      </Field>

      <Field
        label="Total budget"
        helper="The maximum SUI the agent can spend across all cycles."
        right={
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {config.budgetSui} SUI
          </span>
        }
      >
        <input
          type="range"
          min={1}
          max={500}
          step={1}
          value={config.budgetSui}
          onChange={(e) => setField("budgetSui", Number(e.target.value))}
          className="w-full accent-ink"
        />
      </Field>

      <Field
        label="Authorized venues"
        helper="Places the agent is allowed to trade. The chain rejects anything outside this list."
      >
        <div className="flex flex-wrap gap-2">
          {ALL_VENUES.map((v) => {
            const on = config.venues.includes(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => toggleVenue(v)}
                className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                  on
                    ? "border-ink bg-ink text-bg"
                    : "border-line text-ink-2 hover:border-ink-2 hover:text-ink"
                }`}
              >
                {v}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="Expires"
        helper="The agent stops automatically when this clock runs out."
      >
        <div className="flex flex-wrap gap-2">
          {EXPIRY_HOURS_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setField("expiryHours", h)}
              className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                config.expiryHours === h
                  ? "border-ink bg-ink text-bg"
                  : "border-line text-ink-2 hover:border-ink-2 hover:text-ink"
              }`}
            >
              {expiryLabel(h)}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Risk profile"
        helper="Low favours audited and lending venues. High weights toward active markets."
      >
        <div className="flex gap-2">
          {RISK_LEVELS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setField("risk", r)}
              className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                config.risk === r
                  ? "border-ink bg-ink text-bg"
                  : "border-line text-ink-2 hover:border-ink-2 hover:text-ink"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Limit per venue"
        helper="The agent can never put more than this percentage of the total budget in any one place."
        right={
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {config.maxConcentrationPct}%
          </span>
        }
      >
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={config.maxConcentrationPct}
          onChange={(e) =>
            setField("maxConcentrationPct", Number(e.target.value))
          }
          className="w-full accent-ink"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
  right,
  helper,
}: {
  label: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  helper?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {label}
        </label>
        {right}
      </div>
      {helper ? (
        <p className="mb-2 text-[11.5px] leading-[1.5] text-muted">
          {helper}
        </p>
      ) : null}
      {children}
    </div>
  );
}
