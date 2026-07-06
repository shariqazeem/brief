"use client";

// /results · "Did it work?" The outcome-first page. A judge (or depositor)
// opens /results?policy=0x… and sees the operator's objective, return vs the
// alternatives (hold / cash), the risk taken, and the big moments · all real,
// from the on-chain ledger + persisted stats. The view itself lives in
// ResultsView so it can also embed as a tab; this page is a thin wrapper.

import { Suspense } from "react";

import { ResultsView } from "@/components/operator/results-view";

export default function ResultsPage() {
  return (
    <Suspense fallback={null}>
      <ResultsView />
    </Suspense>
  );
}
