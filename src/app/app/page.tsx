"use client";

import Link from "next/link";

export default function AppPage() {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="max-w-3xl mx-auto px-6 pt-24 pb-32">
        <div className="text-[11px] font-mono tracking-[0.22em] uppercase text-muted mb-4">
          workforce · coming
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter mb-6">
          The workforce console is being rebuilt.
        </h1>
        <p className="text-lg text-ink-2 max-w-2xl leading-relaxed mb-8">
          Brief is shipping a new product: an autonomous workforce of AI agents
          that hire each other on-chain. The console returns shortly. The Move
          modules, agent runtimes, and on-chain task settlement are live on Sui
          testnet now.
        </p>
        <div className="flex items-center gap-4 text-sm font-mono">
          <Link
            href="/"
            className="text-ink underline underline-offset-4 font-medium"
          >
            ← Back to landing
          </Link>
        </div>
      </div>
    </main>
  );
}
