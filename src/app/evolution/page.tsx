"use client";

// /evolution · the fourth pillar: the operator getting *better* over time.
// The view now lives in a reusable component so it can also be embedded as a
// tab. This page is a thin wrapper preserving the standalone route + Suspense.

import { Suspense } from "react";

import { EvolutionView } from "@/components/operator/evolution-view";

export default function EvolutionPage() {
  return (
    <Suspense fallback={null}>
      <EvolutionView />
    </Suspense>
  );
}
