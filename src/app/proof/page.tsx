"use client";

// /proof · the verification artifact. A skeptical judge lands here and
// verifies EVERY claim on Suiscan + Walrus without trusting us. Five
// sections, each a card with a left-border colour (emerald = enacted,
// red = refused/revoked, amber = pending) and a one-line fact + a link.
// Walletless + shareable: /proof?policy=0x… renders any operator. Defaults
// to the live house demo operator. All data is read server-side from chain.

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import { BRIEF_NETWORK } from "@/lib/brief-client";
import { EMERALD, RED } from "@/lib/ui";

// ── verified artifacts (each checked `success`/`failure` on the fullnode) ──
const DEFAULT_POLICY =
  "0x15425bdd16f2ba819bc8dbbbada2bf501493cf52f7c1928b1787f64827be57d3";
// The over-budget revert: record_spend aborted EBudgetExceeded; no trade ran.
const OVERBUDGET_TX = "9YqyCqFjF2zgQsvYd1ady1y94EFJ9GoYEG3a4C1swdVw";
// A real on-chain revoke + the policy it retired (reference when the queried
// operator is still active).
const REVOKE_TX = "4yBvc6qVwoXugmZu1jNgNjHRC8ZtqMtoVefsuQZyB4YL";
const REVOKED_POLICY =
  "0x60f7e0a4f26401f5911ba9ce8a9516ac1a19dd9748481f568b5d909967e910c8";

const txUrl = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const objUrl = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;
const addrUrl = (a: string) => `https://suiscan.xyz/testnet/account/${a}`;
const blobUrl = (b: string) =>
  `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${b}`;
const short = (s: string, h = 6, t = 4) =>
  !s ? "-" : s.length <= h + t + 1 ? s : `${s.slice(0, h)}…${s.slice(-t)}`;
const fmtTime = (ms: number) =>
  ms
    ? new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

type Spend = { amount: number; new_spent: number; venue: string | null; ms: number; tx: string };
type ProofData = {
  ok: boolean;
  id: string;
  policy: {
    name: string | null;
    owner: string | null;
    agent: string | null;
    revoked: boolean;
    budget_cap: number;
    spent: number;
    allowed_venues: string[];
    expires_at_ms: number | null;
  } | null;
  spends: Spend[];
  revoke: { revoked_by: string | null; ms: number; tx: string } | null;
  manifestBlob: string | null;
  error?: string;
};

export default function ProofPage() {
  const [policyId, setPolicyId] = useState(DEFAULT_POLICY);
  const [data, setData] = useState<ProofData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manifesto, setManifesto] = useState<string | null>(null);

  // Read ?policy= after mount (avoids any SSR/CSR mismatch).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("policy");
    if (p && /^0x[0-9a-fA-F]{6,}$/.test(p)) setPolicyId(p);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    void (async () => {
      try {
        const r = await fetch(apiUrl(`/api/operators/proof?policy_id=${policyId}`));
        const j = (await r.json()) as ProofData;
        if (cancelled) return;
        if (!j.ok) setErr(j.error ?? "could not load");
        else setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policyId]);

  // Best-effort: pull the manifesto JSON's pledge to show it's real content.
  const blob = data?.manifestBlob ?? null;
  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(blobUrl(blob));
        const j = (await r.json()) as { pledge?: string };
        if (!cancelled && typeof j.pledge === "string") setManifesto(j.pledge);
      } catch {
        /* link still works even if inline fetch fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const unit = BRIEF_NETWORK === "mainnet" ? "USDC" : "DBUSDC";
  const p = data?.policy ?? null;
  const budget = p ? p.budget_cap / 1e6 : 0;
  const spent = p ? p.spent / 1e6 : 0;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:px-10 sm:py-24">
        {/* Header */}
        <header>
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Brief · proof
            </p>
            <nav className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em]">
              <Link href={`/workforce?policy=${policyId}`} className="text-muted transition-opacity hover:opacity-60">
                Dashboard
              </Link>
              <Link href={`/brain?policy=${policyId}`} className="text-muted transition-opacity hover:opacity-60">
                Brain
              </Link>
              <Link href={`/evolution?policy=${policyId}`} className="text-muted transition-opacity hover:opacity-60">
                Evolution
              </Link>
              <Link href={`/results?policy=${policyId}`} className="text-ink transition-opacity hover:opacity-60">
                Results →
              </Link>
            </nav>
          </div>
          <h1 className="mt-4 font-sans text-[32px] font-medium leading-[1.1] tracking-tight text-ink sm:text-[44px]">
            Verify everything.
            <br />
            Trust nothing.
          </h1>
          <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-ink-2">
            Every claim here is a live on-chain artifact. Each link opens Suiscan or
            Walrus · check it yourself.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="text-muted">operator</span>
            <a
              href={objUrl(policyId)}
              target="_blank"
              rel="noreferrer"
              className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
            >
              {short(policyId, 10, 6)}
            </a>
            {p?.name && <span className="text-ink-2">· {p.name}</span>}
          </div>
        </header>

        {err && (
          <div className="mt-10 border-l-[3px] border-[#EF4444] bg-red-50/40 px-4 py-3">
            <p className="font-mono text-[12px] text-[#EF4444]">
              {err === "policy not found"
                ? `No operator with id ${short(policyId, 8, 6)} on ${BRIEF_NETWORK} · the id may be incomplete.`
                : err}
            </p>
            {policyId !== DEFAULT_POLICY && (
              <a
                href="/proof"
                className="mt-2 inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                View the live house operator →
              </a>
            )}
          </div>
        )}
        {!data && !err && (
          <p className="mt-10 font-mono text-[12px] text-muted">Reading the chain…</p>
        )}

        {data && p && (
          <div className="mt-12 space-y-6">
            {/* ── 1 · The Policy ─────────────────────────────────────── */}
            <ProofCard
              accent={p.revoked ? RED : EMERALD}
              n="01"
              title="Your leash is a Move contract."
              line="The budget cap lives on-chain. Our backend doesn't enforce it · the protocol does."
            >
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                      Authorized
                    </span>
                    <span className="font-mono text-[13px] tabular-nums text-ink">
                      {spent.toFixed(3)} / {budget.toFixed(3)} {unit}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden" style={{ background: "#E5E5EA" }}>
                    <div
                      className="h-full"
                      style={{ width: `${pct}%`, background: pct >= 95 ? RED : EMERALD }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-[10.5px] text-ink-2">
                    {(budget - spent).toFixed(3)} {unit} still authorized · the chain
                    stops the rest.
                  </p>
                </div>
                <Row label="Agent (can trade)" value={p.agent} link={p.agent ? addrUrl(p.agent) : null} />
                <Row label="Owner (custody + revoke)" value={p.owner} link={p.owner ? addrUrl(p.owner) : null} />
                <Row
                  label="Status"
                  valueNode={
                    <span style={{ color: p.revoked ? RED : EMERALD }}>
                      {p.revoked ? "REVOKED" : "ACTIVE"}
                    </span>
                  }
                />
              </div>
              <CardLink href={objUrl(policyId)}>OperatorPolicy on Suiscan →</CardLink>
            </ProofCard>

            {/* ── 2 · The Spend Witness ──────────────────────────────── */}
            <ProofCard
              accent={EMERALD}
              n="02"
              title="Every authorized trade is an on-chain event."
              line="Each trade was authorized by record_spend before the DeepBook order executed. Atomic · if the policy says no, the trade never happens."
            >
              {data.spends.length === 0 ? (
                <p className="mt-4 font-mono text-[11px] text-muted">
                  No authorized trades yet · the operator preserves capital until it
                  finds an edge.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {data.spends.map((s) => (
                    <li key={s.tx} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <span className="font-mono text-[12px] tabular-nums text-ink">
                          {(s.amount / 1e6).toFixed(3)} {unit}
                        </span>
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                          {s.venue ?? "-"}
                        </span>
                        <span className="ml-2 font-mono text-[10px] text-ink-2">{fmtTime(s.ms)}</span>
                      </div>
                      <a
                        href={txUrl(s.tx)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-[10.5px] text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                      >
                        {short(s.tx)} →
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </ProofCard>

            {/* ── 3 · The Failed Over-Budget Trade ───────────────────── */}
            <ProofCard
              accent={RED}
              n="03"
              title="When the operator exceeds the cap, the chain says no."
              line="This failed transaction is the most important one on this page. It proves enforcement isn't a backend promise · it's protocol-level reversion. The order never executed; no funds moved."
            >
              <div className="mt-4 flex items-center gap-2">
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: RED }}
                >
                  ✗ failed · EBudgetExceeded
                </span>
              </div>
              <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-ink-2">
                record_spend aborted in <span className="text-ink">assert_can_spend</span>{" "}
                (abort code 5). The whole transaction reverted.
              </p>
              <CardLink href={txUrl(OVERBUDGET_TX)}>Failed transaction on Suiscan →</CardLink>
            </ProofCard>

            {/* ── 4 · The Revocation ─────────────────────────────────── */}
            <ProofCard
              accent={RED}
              n="04"
              title="The kill switch is a transaction, not a toggle."
              line="One on-chain transaction and the operator can never trade again. No backend call. No API-key rotation. The chain revoked the leash."
            >
              {data.revoke ? (
                <>
                  <p className="mt-4 font-mono text-[10.5px] text-ink-2">
                    This operator was revoked {fmtTime(data.revoke.ms)}.
                  </p>
                  <CardLink href={txUrl(data.revoke.tx)}>Revocation transaction on Suiscan →</CardLink>
                </>
              ) : (
                <>
                  <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-ink-2">
                    This operator is active. Revocation is one transaction · here is a
                    real one, and the policy it retired forever:
                  </p>
                  <CardLink href={txUrl(REVOKE_TX)}>Revoke transaction on Suiscan →</CardLink>
                  <CardLink href={objUrl(REVOKED_POLICY)}>Revoked policy (revoked = true) →</CardLink>
                </>
              )}
            </ProofCard>

            {/* ── 5 · The Manifesto (Walrus) ─────────────────────────── */}
            <ProofCard
              accent={EMERALD}
              n="05"
              title="The operator's reasoning is immutable."
              line="The operator publishes its declared identity + pledge to Walrus. Content-addressed · it can't retroactively change its story."
            >
              {blob ? (
                <>
                  {manifesto && (
                    <blockquote className="mt-4 border-l-[2px] border-line pl-3 font-sans text-[13px] italic leading-relaxed text-ink-2">
                      “{manifesto}”
                    </blockquote>
                  )}
                  <p className="mt-3 font-mono text-[10.5px] text-ink-2">
                    blob <span className="text-ink">{short(blob, 8, 6)}</span>
                  </p>
                  <CardLink href={blobUrl(blob)}>Manifesto on Walrus →</CardLink>
                </>
              ) : (
                <p className="mt-4 font-mono text-[11px] text-muted">
                  No manifesto published for this operator yet.
                </p>
              )}
            </ProofCard>
          </div>
        )}

        <footer className="mt-16 border-t border-line pt-6">
          <p className="font-mono text-[10px] leading-relaxed text-muted">
            Every value above is read live from the Sui fullnode + Walrus aggregator.
            Nothing here is rendered from our database. Share this page:{" "}
            <span className="text-ink-2">/proof?policy={short(policyId, 6, 4)}</span>
          </p>
        </footer>
      </div>
    </main>
  );
}

function ProofCard({
  accent,
  n,
  title,
  line,
  children,
}: {
  accent: string;
  n: string;
  title: string;
  line: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="bg-bg-elev p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:p-6"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] tabular-nums text-muted">{n}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <h2 className="mt-3 font-sans text-[18px] font-medium leading-snug tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1.5 max-w-prose text-[12.5px] leading-relaxed text-ink-2">{line}</p>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  valueNode,
  link,
}: {
  label: string;
  value?: string | null;
  valueNode?: React.ReactNode;
  link?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">{label}</span>
      {valueNode ? (
        <span className="font-mono text-[11px] tabular-nums">{valueNode}</span>
      ) : link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
        >
          {short(value ?? "")}
        </a>
      ) : (
        <span className="font-mono text-[11px] text-ink">{short(value ?? "")}</span>
      )}
    </div>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
    >
      {children}
    </a>
  );
}
