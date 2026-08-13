'use client';

import { useFleetStore } from '@/store/fleetStore';

// LivePulse — animated dot + aria-live region (agents.md §6). Announces the
// running live-update count to screen readers politely, and shows an actionable
// paused/reconnecting message rather than a raw "SSE error".
//
// Reads connection scalars only (not hexbin data), so this re-rendering is fine
// and does not violate the no-reconcile-on-data-tick rule.

export function LivePulse() {
  const connected = useFleetStore((s) => s.connected);
  const count = useFleetStore((s) => s.liveUpdateCount);

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span
          className={[
            'absolute inline-flex h-full w-full rounded-full',
            connected ? 'animate-live-pulse bg-driving' : 'bg-parked',
          ].join(' ')}
        />
      </span>
      {connected ? (
        <span className="text-xs text-text-muted">Live</span>
      ) : (
        <span className="text-xs text-text-muted">
          Live feed paused ·{' '}
          <span className="text-accent">Reconnecting…</span>
        </span>
      )}

      {/* Screen-reader-only announcement of update activity. */}
      <span aria-live="polite" className="sr-only">
        {connected
          ? `Live feed connected. ${count} bin updates received.`
          : 'Live feed paused, attempting to reconnect.'}
      </span>
    </div>
  );
}
