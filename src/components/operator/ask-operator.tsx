// Ask Mira · the flagship conversation. A judge or owner types "why did you
// sell?" or "what can't you do?" and the operator answers from its OWN
// verifiable memory (the /api/operators/chat endpoint grounds every reply in the
// real .cursors state and validates any tx/Walrus reference before showing it).
//
// Self-contained on purpose: it takes only policyId + identity, so it survives
// the pages overhaul (it can be dropped into the Live tab, the glass dock, or a
// shared read-only link) without a rewrite. Works walletless via ?policy=.

"use client";

import { useEffect, useRef, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import { BRIEF_NETWORK } from "@/lib/brief-client";
import { suiscanTxUrl, walrusBlobUrl } from "@/lib/operator-feed";

const NETWORK: "mainnet" | "testnet" = BRIEF_NETWORK === "mainnet" ? "mainnet" : "testnet";

type Ref = { txDigest?: string; walrusBlobId?: string };
type Msg = { role: "user" | "assistant"; content: string; refs?: Ref[]; error?: boolean };

const SEEDS = [
  "Why are you holding?",
  "What did you learn this week?",
  "What can't you do?",
];

export function AskOperator({
  policyId,
  name,
  role,
}: {
  policyId: string | null;
  name: string;
  role: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  if (!policyId) return null;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages
      .filter((m) => !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch(apiUrl("/api/operators/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_id: policyId, message, history }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        answer?: string;
        refs?: Ref[];
        error?: string;
      };
      if (j.ok && j.answer) {
        setMessages((m) => [...m, { role: "assistant", content: j.answer!, refs: j.refs ?? [] }]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: j.error ?? "I couldn't answer that right now.", error: true },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Connection issue — try again in a moment.", error: true },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <header
        className="flex items-center justify-between px-5 py-3.5 sm:px-6"
        style={{ borderBottom: "1px solid #ECECEE" }}
      >
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4DA2FF]" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: "#1a2c4e" }}>
            Ask {name}
          </span>
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
          Answers from its own memory
        </span>
      </header>

      <div ref={scrollRef} className="max-h-[440px] space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
        {messages.length === 0 ? (
          <div className="py-4">
            <p className="text-[13px] leading-relaxed text-ink-2">
              {name} is your {role.toLowerCase()}. Ask it anything about what it is doing with your
              capital, what it has learned, or the limits it can never break. Every answer is drawn
              from its verifiable on-chain memory.
            </p>
          </div>
        ) : (
          messages.map((m, i) => <Bubble key={i} msg={m} name={name} />)
        )}
        {busy && (
          <div className="flex items-center gap-1.5 pl-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">{name}</span>
            <span className="flex gap-1">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="h-1 w-1 animate-pulse rounded-full bg-muted"
                  style={{ animationDelay: `${d * 150}ms` }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* suggested prompts */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-2 sm:px-5">
        {SEEDS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => void send(s)}
            className="border border-line px-2 py-1 font-sans text-[11.5px] text-ink-2 transition-colors hover:bg-bg disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 px-4 pb-4 sm:px-5"
        style={{ borderTop: "1px solid #ECECEE", paddingTop: "0.75rem" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${name} a question…`}
          maxLength={1000}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="shrink-0 bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white transition-opacity hover:opacity-80 disabled:opacity-30"
        >
          Ask
        </button>
      </form>
    </section>
  );
}

function Bubble({ msg, name }: { msg: Msg; name: string }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] bg-bg px-3 py-2 text-[13.5px] leading-snug text-ink">
          {msg.content}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">{name}</span>
      <p
        className={`max-w-[92%] text-[13.5px] leading-relaxed ${
          msg.error ? "text-muted" : "text-ink-2"
        }`}
      >
        {msg.content}
      </p>
      {msg.refs && msg.refs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {msg.refs.map((r, i) =>
            r.txDigest ? (
              <a
                key={`tx${i}`}
                href={suiscanTxUrl(r.txDigest, NETWORK)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-700 transition-opacity hover:opacity-60"
              >
                Verify trade ↗
              </a>
            ) : r.walrusBlobId ? (
              <a
                key={`wal${i}`}
                href={walrusBlobUrl(r.walrusBlobId)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-[0.14em] transition-opacity hover:opacity-60"
                style={{ color: "#1a2c4e" }}
              >
                Reasoning on Walrus ↗
              </a>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
