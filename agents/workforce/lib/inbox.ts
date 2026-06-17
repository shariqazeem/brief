// Workforce inbox · polls TaskPosted events filtered by either the agent's
// own assigned_to address OR a target capability label. Cursor-persisted,
// fast-forwards to head on first start to avoid replaying the v3 backlog
// the first time a freshly-deployed agent boots.
//
// Mirrors the shape of agents/lib/event-poll.ts (which targets
// WorkObjectMinted) but is dedicated to brief::task::TaskPosted events so
// agents react only to direct assignments, not the full WorkObject stream.

import type { AgentContext } from "../../lib/sui.js";
import {
  loadCursor,
  saveCursor,
  type EventCursor,
} from "../../lib/cursor.js";
import {
  unwrapOptionId,
  type TaskPostedEvent,
} from "./task.js";

export type TaskPostedNotice = {
  taskId: string;
  poster: string;
  assignedTo: string;
  title: string;
  primaryCapability: string;
  bountyAmount: bigint;
  deadlineMs: bigint;
  parentPolicy: string | null;
  postedAtMs: bigint;
  txDigest: string;
  eventSeq: string;
};

export type TaskInboxOptions = {
  ctx: AgentContext;
  /** Persisted cursor file path (per-agent so multiple agents share the chain). */
  cursorPath: string;
  /** Polling interval in ms. */
  pollMs: number;
  /** Optional: filter to tasks whose assigned_to matches this address. */
  assignedToFilter?: string;
  /** Optional: filter to tasks whose primary_capability matches this label. */
  capabilityFilter?: string;
  /** Optional: log label. */
  label?: string;
  /** Called once per matched event. */
  onTask: (notice: TaskPostedNotice) => Promise<void>;
};

export async function startTaskInbox(opts: TaskInboxOptions): Promise<void> {
  const {
    ctx,
    cursorPath,
    pollMs,
    assignedToFilter,
    capabilityFilter,
    onTask,
    label,
  } = opts;
  let cursor: EventCursor | null = loadCursor(cursorPath);
  let ticking = false;
  const tag = label ?? "inbox";
  const eventType = `${ctx.typeOriginId}::task::TaskPosted`;

  if (!cursor) {
    try {
      const latest = await ctx.client.queryEvents({
        query: { MoveEventType: eventType },
        order: "descending",
        limit: 1,
      });
      if (latest.data[0]) {
        cursor = {
          txDigest: latest.data[0].id.txDigest,
          eventSeq: latest.data[0].id.eventSeq,
        };
        saveCursor(cursorPath, cursor);
        console.log(
          `[${tag}] fast-forwarded cursor to ${cursor.txDigest.slice(0, 8)}…/${cursor.eventSeq}`,
        );
      } else {
        console.log(`[${tag}] no TaskPosted events on chain yet · starting from head`);
      }
    } catch (e) {
      console.warn(
        `[${tag}] fast-forward failed, starting from genesis:`,
        (e as Error)?.message,
      );
    }
  }

  console.log(
    `[${tag}] inbox open: pkg=${ctx.packageId.slice(0, 10)}… filter=${
      assignedToFilter
        ? `to ${assignedToFilter.slice(0, 10)}…`
        : capabilityFilter
          ? `cap=${capabilityFilter}`
          : "ALL"
    } poll=${pollMs}ms`,
  );

  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      const page = await ctx.client.queryEvents({
        query: { MoveEventType: eventType },
        cursor,
        order: "ascending",
        limit: 50,
      });

      for (const ev of page.data) {
        const parsed = ev.parsedJson as TaskPostedEvent;
        if (assignedToFilter && parsed.assigned_to !== assignedToFilter) continue;
        if (
          capabilityFilter &&
          parsed.primary_capability !== capabilityFilter
        )
          continue;

        const notice: TaskPostedNotice = {
          taskId: parsed.task_id,
          poster: parsed.poster,
          assignedTo: parsed.assigned_to,
          title: parsed.title,
          primaryCapability: parsed.primary_capability,
          bountyAmount: BigInt(parsed.bounty_amount),
          deadlineMs: BigInt(parsed.deadline_ms),
          parentPolicy: unwrapOptionId(parsed.parent_policy),
          postedAtMs: BigInt(parsed.posted_at_ms),
          txDigest: ev.id.txDigest,
          eventSeq: ev.id.eventSeq,
        };

        try {
          await onTask(notice);
        } catch (e) {
          console.error(
            `[${tag}] handler error on task ${notice.taskId}:`,
            (e as Error)?.message ?? e,
          );
        }
      }

      if (page.nextCursor) {
        cursor = page.nextCursor;
        saveCursor(cursorPath, cursor);
      }
    } catch (e) {
      console.error(`[${tag}] tick failed:`, (e as Error)?.message ?? e);
    } finally {
      ticking = false;
    }
  };

  await tick();
  setInterval(tick, pollMs);
}
