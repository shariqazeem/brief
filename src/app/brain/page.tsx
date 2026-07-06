"use client";

// /brain · the Operator Brain. Thin route wrapper around the reusable
// BrainView component (which also embeds as a tab elsewhere). Suspense is
// required because BrainView reads the ?policy= search param on mount.

import { Suspense } from "react";

import { BrainView } from "@/components/operator/brain-view";

export default function BrainPage() {
  return (
    <Suspense fallback={null}>
      <BrainView />
    </Suspense>
  );
}
