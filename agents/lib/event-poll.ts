import type { AgentContext } from "./sui.js";
import type { EventCursor } from "./cursor.js";
import { loadCursor, saveCursor } from "./cursor.js";
import type { MintEventPayload } from "./work-object.js";

export type MintEvent = {
  id: string;
  txDigest: string;
  eventSeq: string;
  payload: MintEventPayload;
};

export type EventPollOptions = {
  ctx: AgentContext;
  /** Match only events emitted by this WorkObject kind. */
  acceptsKind: string;
  /** Path to a JSON file that persists the cursor between restarts. */
  cursorPath: string;
  /** Milliseconds between polls. */
  pollMs: number;
  /** Handler invoked once per matched event. */
  onEvent: (event: MintEvent) => Promise<void>;
  /** Optional label for log lines. */
  label?: string;
};

export async function startEventPoll(opts: EventPollOptions): Promise<void> {
  const { ctx, acceptsKind, cursorPath, pollMs, onEvent, label } = opts;
  let cursor: EventCursor | null = loadCursor(cursorPath);
  let ticking = false;
  const tag = label ?? "agent";

  // Fast-forward to current head on first startup so we don't reprocess
  // the backlog (which contains stale events whose gas coins were already
  // consumed and cause version conflicts under concurrent agents).
  if (!cursor) {
    try {
      const latest = await ctx.client.queryEvents({
        query: {
          MoveEventType: `${ctx.typeOriginId}::work_object::WorkObjectMinted`,
        },
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
          `[${tag}] fast-forwarded cursor to event ${cursor.txDigest.slice(0, 8)}…/${cursor.eventSeq}`,
        );
      }
    } catch (e) {
      console.warn(`[${tag}] fast-forward failed, starting from genesis:`, (e as Error)?.message);
    }
  }

  console.log(
    `[${tag}] starting poll: pkg=${ctx.packageId} accepts=${acceptsKind} poll=${pollMs}ms cursor=${
      cursor ? `${cursor.txDigest.slice(0, 8)}…/${cursor.eventSeq}` : "null"
    }`,
  );

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const page = await ctx.client.queryEvents({
        query: {
          MoveEventType: `${ctx.typeOriginId}::work_object::WorkObjectMinted`,
        },
        cursor,
        order: "ascending",
        limit: 50,
      });

      for (const ev of page.data) {
        const parsed = ev.parsedJson as MintEventPayload;
        if (parsed.object_type !== acceptsKind) continue;
        try {
          await onEvent({
            id: parsed.id,
            txDigest: ev.id.txDigest,
            eventSeq: ev.id.eventSeq,
            payload: parsed,
          });
        } catch (e) {
          console.error(
            `[${tag}] error handling event ${parsed.id}:`,
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
