// Boot-time recovery scan for specialist agents.
//
// If a specialist process crashed between accepting a task and submitting
// the deliverable (e.g., a Walrus WAL shortage that escaped the
// try/catch, an SDK panic, a host reboot), the chain is left with a
// Task in ACCEPTED status assigned to this specialist · but the inbox
// cursor has already advanced past the original TaskPosted event, so it
// will never be replayed by the normal poll loop.
//
// This helper runs once on boot, AFTER the agent registers, BEFORE the
// inbox starts. It queries TaskAccepted events filtered by this agent's
// address, fetches each task, and for any still in ACCEPTED status with
// no submitted deliverable, re-enters the same handleTask the inbox
// would have called. handleTask itself is idempotent on the accept step
// (a P3 fix); the recovery path here just drives it.

import type { AgentContext } from "../../lib/sui.js";
import { fetchTask } from "./task.js";
import type { TaskPostedNotice } from "./inbox.js";

export type RecoveryOpts = {
  /** Only act on tasks whose primary_capability matches. */
  capabilityFilter?: string;
  /** Log prefix. */
  label?: string;
  /** Limit how far back we look. */
  eventLimit?: number;
  /** The same callback the inbox calls. handleTask is idempotent on
   *  accept (skips if already accepted, proceeds to deliver). */
  onTask: (notice: TaskPostedNotice) => Promise<void>;
};

export async function recoverStuckTasks(
  ctx: AgentContext,
  opts: RecoveryOpts,
): Promise<void> {
  const tag = opts.label ?? "recovery";
  const limit = opts.eventLimit ?? 100;
  const eventType = `${ctx.typeOriginId}::task::TaskAccepted`;

  let events;
  try {
    events = await ctx.client.queryEvents({
      query: { MoveEventType: eventType },
      order: "descending",
      limit,
    });
  } catch (e) {
    console.warn(
      `[${tag}] could not query TaskAccepted events:`,
      (e as Error)?.message ?? e,
    );
    return;
  }

  let recovered = 0;
  // descending → walk oldest-first so multiple stuck tasks resume in order.
  for (const ev of events.data.slice().reverse()) {
    const p = ev.parsedJson as { task_id?: string; agent?: string };
    if (!p?.task_id || !p?.agent) continue;
    if (p.agent.toLowerCase() !== ctx.address.toLowerCase()) continue;
    let t;
    try {
      t = await fetchTask(ctx, p.task_id);
    } catch {
      continue;
    }
    if (t.status !== "accepted") continue;
    if (t.assignedTo.toLowerCase() !== ctx.address.toLowerCase()) continue;
    if (
      opts.capabilityFilter &&
      t.primaryCapability !== opts.capabilityFilter
    ) {
      continue;
    }
    // A task whose on-chain deadline has passed can never be submitted -
    // task::submit aborts with EDeadlinePassed (code 4). Without this
    // guard the scan re-drives it on every boot forever: wasted gas,
    // log spam, and stale task_started events on the SSE wire.
    if (t.deadlineMs > 0n && BigInt(Date.now()) > t.deadlineMs) {
      console.log(
        `[${tag}] skipping task=${t.id.slice(0, 10)}… "${t.title}" · deadline passed ${new Date(Number(t.deadlineMs)).toISOString()}, submit would abort EDeadlinePassed`,
      );
      continue;
    }
    // Reconstruct enough of the original TaskPosted notice for the
    // handler. txDigest/eventSeq here are from the Accepted event, not
    // the Posted event · they're only used for logging by the handler.
    const notice: TaskPostedNotice = {
      taskId: t.id,
      poster: t.poster,
      assignedTo: t.assignedTo,
      title: t.title,
      primaryCapability: t.primaryCapability,
      bountyAmount: t.bountyAmount,
      deadlineMs: t.deadlineMs,
      parentPolicy: t.parentPolicy,
      postedAtMs: t.postedAtMs,
      txDigest: ev.id.txDigest,
      eventSeq: ev.id.eventSeq,
    };
    console.log(
      `[${tag}] resuming stuck task=${t.id.slice(0, 10)}… "${t.title}" (was accepted, never submitted)`,
    );
    try {
      await opts.onTask(notice);
      recovered += 1;
    } catch (e) {
      console.warn(
        `[${tag}] handler failed on task ${t.id.slice(0, 10)}…:`,
        (e as Error)?.message ?? e,
      );
    }
  }
  if (recovered > 0) {
    console.log(`[${tag}] recovered ${recovered} stuck task(s)`);
  }
}
