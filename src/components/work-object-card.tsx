"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Code2,
  Database,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { explorerUrl } from "@/lib/brief-client";
import type { DecodedWorkObject } from "@/lib/work-object";
import {
  decodePayload,
  fetchWalrusPayload,
  walrusBlobUrl,
} from "@/lib/work-object";

// --------------------------------------------------------------------------
// Per-kind type shapes (mirrored from the agent code, so this file is a
// single source of truth for what the frontend expects from the payload).
// --------------------------------------------------------------------------

type QueryPayload = { topic: string };

type EvaluatedProtocol = {
  protocol: string;
  category: string;
  apy: number;
  tvl_usd: number;
  audit_status: "audited" | "partial" | "unaudited";
  age_days: number;
  risk: "low" | "medium" | "high";
  best_pool?: string;
};

type ResearchPayload = {
  topic: string;
  evaluated: EvaluatedProtocol[];
  top_pick: { protocol: string; apy: number; confidence: number };
  reasoning?: string;
  data_source?: { provider: string; fetched_at_ms?: number };
  llm_provider?: string;
};

type GuardianWarning = {
  kind: string;
  severity: "info" | "amber" | "red";
  message: string;
};

type StrategyPayload = {
  parent_research_id?: string;
  order_size_usd?: number;
  allocation: Record<string, number>;
  projected_30d_yield: number;
  ptb_intent?: {
    operations: { op: string; protocol: string; amount_pct: number }[];
  };
  guardian_warnings: GuardianWarning[];
  reasoning?: string;
  llm_provider?: string;
};

type ConfirmationPayload = {
  confirmed: boolean;
  strategy_id?: string;
  confirmed_at_ms?: number;
};

type Fill = {
  pool: string;
  side: string;
  in_amount: number;
  out_amount: number;
  price: number;
};

type ExecutionPayload = {
  parent_strategy_id?: string;
  mode?: "simulated" | "deepbook" | string;
  ptb_digest?: string;
  fills?: Fill[];
  gas_used?: string;
  pool?: string;
};

// --------------------------------------------------------------------------
// Card chrome · header, ID + explorer link, walrus badge, body, parents
// --------------------------------------------------------------------------

const KIND_PROPS: Record<
  string,
  { label: string; agent: string; feeLabel: string; accent: string }
> = {
  Query: { label: "Query", agent: "user", feeLabel: "0 SUI", accent: "#1a2c4e" },
  Research: { label: "ResearchObject", agent: "ResearchAgent", feeLabel: "0.5 SUI", accent: "#2c3e5f" },
  Strategy: { label: "StrategyObject", agent: "StrategyAgent", feeLabel: "0.5 SUI", accent: "#4DA2FF" },
  StrategyAlt: { label: "StrategyObject", agent: "StrategyAgent · aggressive", feeLabel: "0.5 SUI", accent: "#4DA2FF" },
  Confirmation: { label: "Confirmation", agent: "user · explicit sign", feeLabel: "0 SUI", accent: "#15803D" },
  Execution: { label: "ExecutionReceipt", agent: "ExecutionAgent", feeLabel: "1.2 SUI", accent: "#a16207" },
  Operator: { label: "Operator action", agent: "OperatorAgent", feeLabel: "0.1 SUI", accent: "#4DA2FF" },
  Rejection: { label: "Action rejected", agent: "OperatorAgent · policy aborted", feeLabel: "0 SUI", accent: "#dc2626" },
};

export function WorkObjectCard({ obj }: { obj: DecodedWorkObject }) {
  const props = KIND_PROPS[obj.kind] ?? {
    label: obj.kind,
    agent: "agent",
    feeLabel: `${(Number(obj.paymentAmount) / 1e9).toFixed(2)} SUI`,
    accent: "#6b7888",
  };

  const [walrusPayload, setWalrusPayload] = useState<unknown | null>(null);
  const [walrusLoading, setWalrusLoading] = useState(false);
  const [walrusError, setWalrusError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!obj.walrusBlobId || obj.payloadBytes) return;
    setWalrusLoading(true);
    setWalrusError(null);
    const ctl = new AbortController();
    fetchWalrusPayload(obj.walrusBlobId, ctl.signal)
      .then((data) => setWalrusPayload(data))
      .catch((e) => setWalrusError((e as Error)?.message ?? "fetch failed"))
      .finally(() => setWalrusLoading(false));
    return () => ctl.abort();
  }, [obj.walrusBlobId, obj.payloadBytes]);

  const parsed: unknown = (() => {
    if (obj.payloadBytes) {
      try {
        return decodePayload(obj.payloadBytes);
      } catch {
        return null;
      }
    }
    return walrusPayload;
  })();

  return (
    <article className="flex flex-col gap-4 rounded-[14px] border border-line bg-bg-elev p-6 transition-colors animate-fade-up hover:border-line-strong">
      <header className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {props.label}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          {props.feeLabel}
        </span>
      </header>

      <div>
        <a
          href={explorerUrl("object", obj.id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[13px] text-ink hover:underline"
        >
          {obj.id.slice(0, 14)}…{obj.id.slice(-6)}
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
        </a>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          owned by you &middot; {props.agent}
        </p>
      </div>

      {obj.walrusBlobId ? (
        <a
          href={walrusBlobUrl(obj.walrusBlobId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-2 transition-colors hover:text-ink hover:underline"
        >
          <Database className="h-3 w-3" strokeWidth={1.75} />
          payload on walrus &middot; {obj.walrusBlobId.slice(0, 14)}…
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
        </a>
      ) : null}

      {parsed ? (
        showRaw ? (
          <PayloadPreview text={JSON.stringify(parsed, null, 2)} />
        ) : (
          <StructuredView kind={obj.kind} payload={parsed} accent={props.accent} />
        )
      ) : walrusLoading ? (
        <p className="rounded-[10px] border border-dashed border-line bg-bg p-4 font-mono text-[10.5px] text-muted animate-pulse-glow">
          fetching from walrus…
        </p>
      ) : walrusError ? (
        <p className="rounded-[10px] border border-dashed border-line bg-bg p-4 font-mono text-[10.5px] text-red-600">
          walrus fetch failed: {walrusError.slice(0, 80)}
        </p>
      ) : null}

      {parsed ? (
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex w-fit items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted hover:text-ink"
        >
          <Code2 className="h-3 w-3" strokeWidth={1.75} />
          {showRaw ? "structured view" : "raw json"}
        </button>
      ) : null}

      {obj.parentIds.length > 0 ? (
        <footer className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-muted">
          <span>parents:</span>
          {obj.parentIds.map((p) => (
            <a
              key={p}
              href={explorerUrl("object", p)}
              target="_blank"
              rel="noreferrer"
              className="text-ink-2 hover:text-ink hover:underline"
            >
              {p.slice(0, 10)}…
            </a>
          ))}
        </footer>
      ) : null}
    </article>
  );
}

// --------------------------------------------------------------------------
// StructuredView · kind-specific renderer dispatch
// --------------------------------------------------------------------------

function StructuredView({
  kind,
  payload,
  accent,
}: {
  kind: string;
  payload: unknown;
  accent: string;
}) {
  const p = payload as Record<string, unknown>;
  switch (kind) {
    case "Query":
      return <QueryView payload={p as QueryPayload} />;
    case "Research":
      return <ResearchView payload={p as ResearchPayload} accent={accent} />;
    case "Strategy":
    case "StrategyAlt":
      return <StrategyView payload={p as StrategyPayload} accent={accent} />;
    case "Confirmation":
      return <ConfirmationView payload={p as ConfirmationPayload} />;
    case "Execution":
      return <ExecutionView payload={p as ExecutionPayload} />;
    default:
      return <PayloadPreview text={JSON.stringify(payload, null, 2)} />;
  }
}

// --------------------------------------------------------------------------
// Per-kind views
// --------------------------------------------------------------------------

function QueryView({ payload }: { payload: QueryPayload }) {
  return (
    <blockquote className="rounded-[10px] border-l-2 border-ink-2 bg-bg px-4 py-3 text-[14px] leading-[1.5] text-ink-2">
      “{payload.topic}”
    </blockquote>
  );
}

function ResearchView({
  payload,
  accent,
}: {
  payload: ResearchPayload;
  accent: string;
}) {
  const top = payload.top_pick;
  const evaluated = payload.evaluated ?? [];
  return (
    <div className="flex flex-col gap-3">
      {/* Top pick headline */}
      <div className="rounded-[10px] border border-line bg-bg px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          top pick · {(top.confidence * 100).toFixed(0)}% confidence
        </p>
        <p className="mt-1 text-[16px] font-medium text-ink">
          {top.protocol}{" "}
          {top.apy > 0 ? (
            <span className="font-mono text-[13px] text-ink-2">
              {top.apy.toFixed(2)}% APY
            </span>
          ) : null}
        </p>
      </div>

      {/* Evaluated protocols */}
      <div className="flex flex-col gap-1.5">
        {evaluated.slice(0, 5).map((p) => (
          <ProtocolRow key={p.protocol} p={p} accent={accent} />
        ))}
      </div>

      {/* Reasoning + source */}
      {payload.reasoning ? (
        <p className="text-[12.5px] leading-[1.6] text-ink-2">
          {payload.reasoning}
        </p>
      ) : null}
      {payload.data_source ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          source · {payload.data_source.provider}
          {payload.llm_provider ? ` · reasoning · ${payload.llm_provider}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function ProtocolRow({
  p,
  accent,
}: {
  p: EvaluatedProtocol;
  accent: string;
}) {
  const tvl =
    p.tvl_usd >= 1e9
      ? `$${(p.tvl_usd / 1e9).toFixed(2)}B`
      : p.tvl_usd >= 1e6
        ? `$${(p.tvl_usd / 1e6).toFixed(1)}M`
        : `$${(p.tvl_usd / 1e3).toFixed(0)}k`;
  const auditColor =
    p.audit_status === "audited"
      ? "text-green-700 bg-green-50"
      : p.audit_status === "partial"
        ? "text-amber-700 bg-amber-50"
        : "text-red-700 bg-red-50";
  const riskColor =
    p.risk === "low"
      ? "text-green-700"
      : p.risk === "medium"
        ? "text-amber-700"
        : "text-red-700";
  void accent;
  return (
    <div className="flex items-center justify-between gap-2 rounded-[8px] border border-line bg-bg px-3 py-2 text-[12px]">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{p.protocol}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          {p.category}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-2">{tvl}</span>
        {p.apy > 0 ? (
          <span className="font-mono text-[11px] text-ink-2">
            {p.apy.toFixed(1)}%
          </span>
        ) : null}
        <span
          className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${auditColor}`}
        >
          {p.audit_status}
        </span>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.12em] ${riskColor}`}
        >
          {p.risk}
        </span>
      </div>
    </div>
  );
}

function StrategyView({
  payload,
  accent,
}: {
  payload: StrategyPayload;
  accent: string;
}) {
  const allocation = payload.allocation ?? {};
  const entries = Object.entries(allocation).filter(([, v]) => v > 0);
  const yieldPct = (payload.projected_30d_yield ?? 0) * 100;
  const warnings = payload.guardian_warnings ?? [];

  // Palette for allocation segments
  const palette = ["#1a2c4e", "#4DA2FF", "#15803D", "#a16207", "#94a3b8"];

  return (
    <div className="flex flex-col gap-3">
      {/* Allocation bar */}
      <div>
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            allocation
          </p>
          <p className="font-mono text-[11px] text-ink-2">
            +{yieldPct.toFixed(2)}% / 30d
          </p>
        </div>
        <div className="mt-2 flex h-6 w-full overflow-hidden rounded-md border border-line">
          {entries.map(([name, frac], i) => (
            <div
              key={name}
              title={`${name}: ${(frac * 100).toFixed(0)}%`}
              style={{
                width: `${frac * 100}%`,
                background: palette[i % palette.length],
              }}
              className="h-full transition-all"
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {entries.map(([name, frac], i) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-ink-2"
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: palette[i % palette.length] }}
              />
              {name} · {(frac * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      {/* Guardian warnings */}
      {warnings.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {warnings.map((w, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[12px] ${
                w.severity === "red"
                  ? "border-red-200 bg-red-50 text-red-800"
                  : w.severity === "amber"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-line bg-bg text-ink-2"
              }`}
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <div className="min-w-0">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.14em]">
                  {w.kind.replace(/_/g, " ")} · {w.severity}
                </p>
                <p className="mt-0.5 text-[12px] leading-[1.45]">{w.message}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-green-700">
          <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
          no guardian warnings
        </p>
      )}

      {payload.reasoning ? (
        <p className="text-[12.5px] leading-[1.55] text-ink-2">{payload.reasoning}</p>
      ) : null}
      {void accent}
    </div>
  );
}

function ConfirmationView({ payload }: { payload: ConfirmationPayload }) {
  const when = payload.confirmed_at_ms
    ? new Date(payload.confirmed_at_ms).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        month: "short",
        day: "numeric",
      })
    : "-";
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-green-200 bg-green-50 px-4 py-3">
      <CheckCircle2 className="h-5 w-5 text-green-700" strokeWidth={1.75} />
      <div>
        <p className="text-[13px] font-medium text-green-900">
          User signed and approved execution
        </p>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-green-700">
          confirmed at {when}
        </p>
      </div>
    </div>
  );
}

function ExecutionView({ payload }: { payload: ExecutionPayload }) {
  const mode = payload.mode ?? "simulated";
  const fills = payload.fills ?? [];
  return (
    <div className="flex flex-col gap-3">
      {/* Mode + pool */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
            mode === "deepbook"
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          <Sparkles className="h-3 w-3" strokeWidth={1.75} />
          mode · {mode}
        </span>
        {payload.pool ? (
          <span className="inline-flex items-center rounded-full bg-bg px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-2">
            pool · {payload.pool}
          </span>
        ) : null}
      </div>

      {/* PTB digest link */}
      {payload.ptb_digest ? (
        <a
          href={explorerUrl("txblock", payload.ptb_digest)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11.5px] text-ink-2 transition-colors hover:text-ink hover:underline"
        >
          ptb digest · {payload.ptb_digest.slice(0, 14)}…
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
        </a>
      ) : null}

      {/* Fills table */}
      {fills.length > 0 ? (
        <div className="overflow-hidden rounded-[8px] border border-line">
          <table className="w-full text-[11px]">
            <thead className="bg-bg">
              <tr className="font-mono uppercase tracking-[0.14em] text-[9.5px] text-muted">
                <th className="px-3 py-1.5 text-left">pool</th>
                <th className="px-3 py-1.5 text-right">in</th>
                <th className="px-3 py-1.5 text-right">out</th>
                <th className="px-3 py-1.5 text-right">px</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-2">{f.pool}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink">
                    {Number(f.in_amount).toFixed(3)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink">
                    {Number(f.out_amount).toFixed(3)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-2">
                    {Number(f.price).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Fallback raw JSON view (auto-explorer-linked)
// --------------------------------------------------------------------------

function PayloadPreview({ text }: { text: string }) {
  const objectIdRe = /(0x[a-fA-F0-9]{64})/g;
  const txDigestRe = /\b([1-9A-HJ-NP-Za-km-z]{43,44})\b/g;
  const parts: Array<{ kind: "text" | "obj" | "tx"; value: string }> = [];

  const merged = text.split(objectIdRe);
  for (let k = 0; k < merged.length; k++) {
    if (k % 2 === 1) {
      parts.push({ kind: "obj", value: merged[k] });
      continue;
    }
    const sub = merged[k].split(txDigestRe);
    for (let j = 0; j < sub.length; j++) {
      if (j % 2 === 1) {
        parts.push({ kind: "tx", value: sub[j] });
      } else {
        parts.push({ kind: "text", value: sub[j] });
      }
    }
  }

  return (
    <pre className="max-h-72 overflow-auto rounded-[10px] border border-line bg-bg p-4 font-mono text-[10.5px] leading-[1.65] text-ink-2 whitespace-pre-wrap break-words">
      {parts.map((p, idx) => {
        if (p.kind === "text") return p.value;
        const href = explorerUrl(p.kind === "obj" ? "object" : "txblock", p.value);
        return (
          <a
            key={idx}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-ink-2 transition-colors hover:text-ink hover:underline"
          >
            {p.value}
          </a>
        );
      })}
    </pre>
  );
}
