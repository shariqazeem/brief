"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Command Palette — ⌘K (or Ctrl+K) opens a centered modal with a search
 * input and a list of operational actions. Linear-quality keyboard nav:
 *
 *   ⌘K   toggle
 *   ↑↓   navigate
 *   ⏎    execute selected
 *   Esc  close
 *
 * Actions are passed in from the consumer — this component knows nothing
 * about Brief's state. The consumer assembles a contextual list based on
 * whether there's a live operator, etc.
 */

export type Command = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  /** When true the row is rendered red — used by revoke. */
  destructive?: boolean;
  perform: () => void;
};

export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = (
        c.label +
        " " +
        (c.hint ?? "") +
        " " +
        (c.keywords?.join(" ") ?? "")
      ).toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(0);
  }, [query, open]);

  // Keyboard surface
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmdK =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (cmdK) {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const c = filtered[selectedIdx];
        if (c) {
          setOpen(false);
          c.perform();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, selectedIdx]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-[520px] overflow-hidden rounded-[16px] border border-line-strong bg-bg-elev shadow-[0_24px_60px_-20px_rgba(15,26,44,0.45)] animate-fade-up">
        <div className="border-b border-line">
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command…"
            className="w-full bg-transparent px-5 py-4 text-[15px] text-ink outline-none placeholder:text-muted"
            aria-label="Command search"
          />
        </div>

        <ul className="max-h-[55vh] overflow-y-auto py-2" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-5 py-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              no matching commands
            </li>
          ) : (
            filtered.map((c, i) => {
              const active = i === selectedIdx;
              return (
                <li key={c.id} role="option" aria-selected={active}>
                  <button
                    onMouseEnter={() => setSelectedIdx(i)}
                    onClick={() => {
                      setOpen(false);
                      c.perform();
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors ${
                      active ? "bg-bg" : ""
                    }`}
                  >
                    <span
                      className={`truncate text-[13.5px] ${
                        c.destructive
                          ? active
                            ? "text-red-700"
                            : "text-red-600"
                          : "text-ink"
                      }`}
                    >
                      {c.label}
                    </span>
                    {c.hint ? (
                      <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">
                        {c.hint}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-t border-line px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          ⌘K toggle &middot; ↑↓ navigate &middot; ⏎ execute &middot; esc close
        </div>
      </div>
    </div>
  );
}
