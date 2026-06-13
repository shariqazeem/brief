// React hooks for the frontend's interaction with Brief on-chain state.

"use client";

import { useEffect, useState } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { fetchWorkObject, type DecodedWorkObject } from "./work-object";

/**
 * The LATEST published package id. Use for `tx.moveCall({ target: ... })`
 * and for any module added in a later version (e.g. operator_policy).
 */
// .trim() guards against stray whitespace on the platform env value —
// Vercel envs sometimes ship with trailing newlines.
export const BRIEF_PACKAGE_ID = (
  process.env.NEXT_PUBLIC_BRIEF_PACKAGE_ID ?? "0x0"
).trim();

/**
 * The ORIGINAL publish-at id. Sui normalizes on-chain type ids to the
 * first publish — so `getOwnedObjects({ filter: { StructType } })` and
 * `queryEvents({ filter: { MoveEventType } })` for any type defined in v1
 * must use this id. Falls back to BRIEF_PACKAGE_ID for pre-upgrade builds.
 */
export const BRIEF_TYPE_ORIGIN_ID = (
  process.env.NEXT_PUBLIC_BRIEF_TYPE_ORIGIN_ID ??
  process.env.NEXT_PUBLIC_BRIEF_PACKAGE_ID ??
  "0x0"
).trim();

export const BRIEF_NETWORK = (
  process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet"
).trim() as "testnet" | "mainnet";

/**
 * The Treasury wallet — the trader agent that signs the gated mint
 * (predict::mint + operator_policy::record_spend). `assert_can_spend`
 * requires `sender == policy.agent`, so an adopted trader's policy MUST
 * bind its agent to THIS address for live mints to clear (otherwise the
 * mint aborts ENotAgent → honest simulated). Public address; env-
 * overridable. Keep in sync with TREASURY_SECRET_KEY on the VM.
 */
export const BRIEF_TRADER_ADDRESS = (
  process.env.NEXT_PUBLIC_BRIEF_TRADER_ADDRESS ??
  "0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf"
).trim();

/**
 * Sui Explorer URL. suiexplorer.com was retired in 2025; we use suiscan.xyz
 * which is the Mysten-recommended replacement. The legacy "txblock" name is
 * preserved on this helper's API for back-compat — suiscan calls it "tx".
 */
export function explorerUrl(
  kind: "object" | "txblock",
  value: string,
): string {
  const slug = kind === "txblock" ? "tx" : "object";
  return `https://suiscan.xyz/${BRIEF_NETWORK}/${slug}/${value}`;
}

/**
 * Poll for WorkObjects owned by a given address. Returns the freshest list,
 * sorted descending by mint timestamp. Polling continues until unmount.
 */
export function useOwnedWorkObjects(
  owner: string | undefined,
  pollMs = 2500,
): { items: DecodedWorkObject[]; loading: boolean } {
  const client = useSuiClient();
  const [items, setItems] = useState<DecodedWorkObject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!owner) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const owned = await client.getOwnedObjects({
          owner,
          filter: {
            StructType: `${BRIEF_TYPE_ORIGIN_ID}::work_object::WorkObject`,
          },
          options: { showContent: true, showOwner: true },
        });

        const decoded: DecodedWorkObject[] = [];
        for (const entry of owned.data) {
          const content = entry.data?.content;
          if (!content || content.dataType !== "moveObject") continue;
          const id = entry.data?.objectId;
          if (!id) continue;
          const obj = await fetchWorkObject(client, id);
          if (obj) decoded.push(obj);
        }

        decoded.sort((a, b) =>
          Number(b.timestampMs - a.timestampMs) || a.id.localeCompare(b.id),
        );

        if (!cancelled) {
          setItems(decoded);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const handle = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [owner, client, pollMs]);

  return { items, loading };
}

/**
 * Fetch a single WorkObject by ID with light polling (for the lineage page).
 */
export function useWorkObject(
  id: string | undefined,
  pollMs = 4000,
): { obj: DecodedWorkObject | null; loading: boolean } {
  const client = useSuiClient();
  const [obj, setObj] = useState<DecodedWorkObject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setObj(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const fetched = await fetchWorkObject(client, id);
        if (!cancelled) {
          setObj(fetched);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const handle = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [id, client, pollMs]);

  return { obj, loading };
}
