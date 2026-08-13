import {
  getAllBins,
  getLatestDiff,
  getMeta,
  getRegionSummaries,
  isRedisConfigured,
} from '@/lib/redis';
import type { BinsSnapshot } from '@/lib/types';

// GET /api/stream — SSE reader (agents.md §5).
//
// PURE READER. It never writes to Redis. Every mutation lives in /api/writer;
// putting the mutation loop here would give each connected client its own writer
// (two tabs = 2× write rate, uncoordinated), which is broken at two users.
//
// Demo exception: the connect-time kick below invokes the writer once; all
// ongoing stream work remains read-only and mutation logic stays in /api/writer.
//
// Node runtime, not Edge: SSE needs a persistent connection an Edge function
// can't hold open.
//
// SSE, not WebSockets: this is a read-only dashboard with no client→server push,
// so a duplex transport would be complexity with no matching requirement — and
// EventSource gives us reconnect-with-backoff for free.
//
// KNOWN LIMITATION (§9, named not hidden): each open connection is a live
// serverless invocation polling Redis independently — N viewers = N× reads. Fine
// for a demo; production moves fan-out to a persistent WS process or managed
// pub/sub (Ably/Pusher/PartyKit). Upstash's REST client also can't hold a
// persistent SUBSCRIBE, which is why this polls rather than subscribes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Diff poll interval. QStash's free tier fires the writer at 60s minimum, so a
 *  5s poll means a client sees the change within 5s of it landing (§5). */
const POLL_MS = 5_000;
/** Heartbeat comment — keeps proxies and load balancers from idling us out. */
const HEARTBEAT_MS = 15_000;
/** Hard cap on connection lifetime, below the platform's function timeout, so
 *  the close is orderly and EventSource reconnects cleanly. */
const MAX_CONNECTION_MS = 240_000;

export async function GET(request: Request) {
  if (!isRedisConfigured()) {
    return new Response('Fleet data store not configured', { status: 503 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let pollTimer: ReturnType<typeof setInterval> | undefined;
      let beatTimer: ReturnType<typeof setInterval> | undefined;
      let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;

      /** ETag: the diff's own ts. Only pushes when the document actually changes. */
      let lastTs = 0;

      const send = (event: string, data: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
          return true;
        } catch {
          close();
          return false;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (beatTimer) clearInterval(beatTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        try {
          controller.close();
        } catch {
          // Already closed by the client aborting — nothing to do.
        }
      };

      // Client navigated away / EventSource closed.
      request.signal.addEventListener('abort', close);

      // Demo-mode initial kick: invoke the single writer once per SSE
      // connection so opening the app produces fresh data immediately. The
      // writer retains QStash Receiver verification for real deliveries; this
      // path intentionally uses its manual-test secret fallback.
      try {
        const host = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
        const writerResponse = await fetch(`${host}/api/writer`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-writer-secret': process.env.WRITER_SECRET ?? '',
          },
          body: '{}',
        });
        if (!writerResponse.ok) {
          // A missing demo secret or transient writer failure is non-fatal.
        }
      } catch {
        // Snapshot and diff polling remain available if the initial kick fails.
      }

      // 1. On connect: full snapshot, so a late joiner is immediately correct
      //    without waiting for the next diff (§5).
      try {
        const [bins, regions, meta] = await Promise.all([
          getAllBins(),
          getRegionSummaries(),
          getMeta(),
        ]);
        const snapshot: BinsSnapshot = {
          bins,
          regions,
          meta: {
            total_vehicles:
              meta.total_vehicles || bins.reduce((s, b) => s + b.vehicle_count, 0),
            last_updated: meta.last_updated || Date.now(),
          },
        };
        send('snapshot', snapshot);
      } catch {
        send('error', {
          message: 'Live feed paused · Reconnecting…',
        });
        close();
        return;
      }

      // Seed the ETag with whatever diff already exists, so a fresh connection
      // doesn't replay a diff the snapshot already reflects.
      try {
        const existing = await getLatestDiff();
        if (existing) lastTs = existing.ts;
      } catch {
        // Non-fatal: worst case we push one redundant diff.
      }

      // 2. Poll the diff document; push only on change.
      pollTimer = setInterval(async () => {
        if (closed) return;
        try {
          const diff = await getLatestDiff();
          if (diff && diff.ts !== lastTs && diff.bins.length > 0) {
            lastTs = diff.ts;
            send('diff', diff);
          }
        } catch {
          // Transient Redis error: keep the connection open and retry next tick.
          // Tearing down would make the client reconnect for no reason.
        }
      }, POLL_MS);

      // 3. Heartbeat comment (not an event — the client ignores it entirely).
      beatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);

      lifetimeTimer = setTimeout(close, MAX_CONNECTION_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) — without this, events arrive in bursts.
      'X-Accel-Buffering': 'no',
    },
  });
}
