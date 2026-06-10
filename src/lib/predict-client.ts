// Read-only DeepBook Predict helpers for the browser. Stays light —
// uses the SuiClient already in the bundle via dApp Kit; no extra SDK
// imports, no signing primitives.
//
// The trader's open-position panel calls `useLiveSpot(oracleId)` to
// tick the BTC spot every ~8s. The same trick we use in the agent's
// trader/index.ts: `oracle::spot_price` is a pure read that runs
// inside `devInspectTransactionBlock` and returns a u64 in 1e9 units.

"use client";

import { useEffect, useRef, useState } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";

const PREDICT_PACKAGE =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";

// devInspect needs a sender for gas estimation — read-only calls don't
// debit anyone, but the RPC still wants a valid address. The Treasury
// wallet always exists on chain so it's a safe sentinel.
const READ_SENDER =
  "0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf";

// Cadence + backoff. 8s base feels alive without melting the RPC; on
// any transient failure we ramp up to 32s and label the state
// "reconnecting" so the UI can show a quiet recovery affordance.
const POLL_BASE_MS = 8_000;
const POLL_BACKOFF_MS = [12_000, 20_000, 32_000];
const BACKOFF_CAP_MS = 32_000;

export type LiveSpot = {
  /** Spot in 1e9 raw units; null until the first successful read. */
  spotRaw: bigint | null;
  /** Wall-clock when `spotRaw` was last updated (0 → never). */
  lastUpdatedMs: number;
  /** `loading` (no reads yet), `live` (last poll succeeded),
   *  `reconnecting` (last poll failed; backoff active). */
  status: "loading" | "live" | "reconnecting";
};

const INITIAL: LiveSpot = {
  spotRaw: null,
  lastUpdatedMs: 0,
  status: "loading",
};

/** Poll the BTC oracle's spot via devInspect. Returns a stable
 *  snapshot the consumer can render directly; we update only on
 *  changes so a re-render isn't forced 8 times a minute when the
 *  price hasn't moved. */
export function useLiveSpot(
  oracleId: string | null | undefined,
): LiveSpot {
  const sui = useSuiClient();
  const [state, setState] = useState<LiveSpot>(INITIAL);
  const failuresRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!oracleId || !oracleId.startsWith("0x")) {
      setState(INITIAL);
      return;
    }
    cancelledRef.current = false;
    failuresRef.current = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${PREDICT_PACKAGE}::oracle::spot_price`,
          arguments: [tx.object(oracleId as string)],
        });
        const r = await sui.devInspectTransactionBlock({
          sender: READ_SENDER,
          transactionBlock: tx,
        });
        const ret = r.results?.[0]?.returnValues?.[0];
        if (!ret) throw new Error("no return value");
        const [bytes] = ret;
        const nextRaw = BigInt(bcs.U64.parse(Uint8Array.from(bytes)));
        if (!cancelledRef.current) {
          failuresRef.current = 0;
          setState((prev) => {
            if (
              prev.spotRaw === nextRaw &&
              prev.status === "live" &&
              prev.lastUpdatedMs !== 0
            ) {
              // No-op: avoid noisy re-renders when the price hasn't
              // changed. Only the timestamp would move; the consumer
              // doesn't need to know about a 0-delta tick.
              return prev;
            }
            return {
              spotRaw: nextRaw,
              lastUpdatedMs: Date.now(),
              status: "live",
            };
          });
        }
        scheduleNext(POLL_BASE_MS);
      } catch {
        if (cancelledRef.current) return;
        failuresRef.current += 1;
        setState((prev) => ({
          // Keep the last known spot visible — the UI label shifts
          // to "reconnecting" but the user still sees a meaningful
          // value (and the win/loss inference still uses it).
          spotRaw: prev.spotRaw,
          lastUpdatedMs: prev.lastUpdatedMs,
          status: prev.spotRaw === null ? "loading" : "reconnecting",
        }));
        const i = Math.min(
          failuresRef.current - 1,
          POLL_BACKOFF_MS.length - 1,
        );
        scheduleNext(Math.min(POLL_BACKOFF_MS[i] ?? BACKOFF_CAP_MS, BACKOFF_CAP_MS));
      }
    }
    function scheduleNext(ms: number) {
      if (cancelledRef.current) return;
      timer = setTimeout(() => {
        void tick();
      }, ms);
    }

    // Kick off immediately so the panel has a value within ~1 round-trip.
    void tick();

    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [sui, oracleId]);

  return state;
}

/** Tiny helper — divide a 1e9 spot/strike to a USD number. */
export function rawToUsd(raw: bigint | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return Number(raw) / 1_000_000_000;
}

/** DeepBook v3 testnet package — used for the spot mid-price devInspect.
 *  Mirrors the BTC oracle pattern; the move call is
 *  `pool::mid_price<Base, Quote>(pool, clock)` returning u64. */
const DEEPBOOK_PACKAGE_ID =
  "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c";
const SUI_CLOCK_OBJECT_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000006";

export type LiveSpotMid = {
  /** Current mid price as a USD number (e.g. 0.751 for $0.751/SUI).
   *  Null until the first successful read. */
  midUsd: number | null;
  lastUpdatedMs: number;
  status: "loading" | "live" | "reconnecting";
};

const INITIAL_MID: LiveSpotMid = {
  midUsd: null,
  lastUpdatedMs: 0,
  status: "loading",
};

/** Poll a DeepBook v3 pool's mid price via devInspect. Parallel to
 *  `useLiveSpot` for BTC; used by the dashboard for SUI/WAL/DEEP
 *  spot positions so the open-position panel has the same live-tick +
 *  winning/losing tension. */
export function useSpotMid(
  poolId: string | null | undefined,
  baseCoinType: string | null | undefined,
  quoteCoinType: string | null | undefined,
  baseScalar: number,
  quoteScalar: number,
): LiveSpotMid {
  const sui = useSuiClient();
  const [state, setState] = useState<LiveSpotMid>(INITIAL_MID);
  const failuresRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!poolId || !baseCoinType || !quoteCoinType) {
      setState(INITIAL_MID);
      return;
    }
    cancelledRef.current = false;
    failuresRef.current = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::pool::mid_price`,
          typeArguments: [baseCoinType as string, quoteCoinType as string],
          arguments: [
            tx.object(poolId as string),
            tx.object(SUI_CLOCK_OBJECT_ID),
          ],
        });
        const r = await sui.devInspectTransactionBlock({
          sender:
            "0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf",
          transactionBlock: tx,
        });
        const ret = r.results?.[0]?.returnValues?.[0];
        if (!ret) throw new Error("no return value");
        const [bytes] = ret;
        const raw = BigInt(bcs.U64.parse(Uint8Array.from(bytes)));
        // SDK formula: adjusted = raw * baseScalar / quoteScalar / 1e9
        const midUsd = (Number(raw) * baseScalar) / quoteScalar / 1e9;
        if (!cancelledRef.current) {
          failuresRef.current = 0;
          setState((prev) => {
            if (prev.midUsd === midUsd && prev.status === "live" && prev.lastUpdatedMs !== 0) {
              return prev;
            }
            return { midUsd, lastUpdatedMs: Date.now(), status: "live" };
          });
        }
        scheduleNext(POLL_BASE_MS);
      } catch {
        if (cancelledRef.current) return;
        failuresRef.current += 1;
        setState((prev) => ({
          midUsd: prev.midUsd,
          lastUpdatedMs: prev.lastUpdatedMs,
          status: prev.midUsd === null ? "loading" : "reconnecting",
        }));
        const i = Math.min(failuresRef.current - 1, POLL_BACKOFF_MS.length - 1);
        scheduleNext(Math.min(POLL_BACKOFF_MS[i] ?? BACKOFF_CAP_MS, BACKOFF_CAP_MS));
      }
    }
    function scheduleNext(ms: number) {
      if (cancelledRef.current) return;
      timer = setTimeout(() => {
        void tick();
      }, ms);
    }

    void tick();

    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [sui, poolId, baseCoinType, quoteCoinType, baseScalar, quoteScalar]);

  return state;
}
