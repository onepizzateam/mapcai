'use client';

import { useEffect } from 'react';
import { useFleetStore } from './fleetStore';
import type { BinsSnapshot, FleetDiff } from '@/lib/types';

// useSSEStream — GET /api/stream → store.applyDiff (agents.md §3, §5).
//
// CRITICAL (hard rule 1): this hook calls store actions imperatively via
// getState() and holds NO React state of its own. A `useState` here would
// re-render the whole subtree on every tick, which is exactly the reconciliation
// the plan exists to avoid. The store mutates bins in place and bumps
// diffVersion; HexLayer's out-of-React subscribe picks that up and drives a D3
// transition. React never reconciles on a data tick.
//
// EventSource reconnects on its own with backoff, so there's no retry loop here —
// only a connection-status flag so the UI can say "Live feed paused ·
// Reconnecting…" instead of silently going stale.

export function useSSEStream(): void {
  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;

    const { setSnapshot, applyDiff, setConnected } = useFleetStore.getState();

    const connect = () => {
      if (disposed) return;

      source = new EventSource('/api/stream');

      source.addEventListener('open', () => setConnected(true));

      // Full snapshot on connect (and on every reconnect) — a reconnecting
      // client can't trust its in-memory bins, since it missed N diffs.
      source.addEventListener('snapshot', (event) => {
        try {
          const snap = JSON.parse((event as MessageEvent<string>).data) as BinsSnapshot;
          setSnapshot({
            bins: snap.bins,
            regions: snap.regions,
            total_vehicles: snap.meta.total_vehicles,
            last_updated: snap.meta.last_updated,
          });
          setConnected(true);
        } catch {
          // Malformed frame: ignore it. The next diff or reconnect recovers.
        }
      });

      source.addEventListener('diff', (event) => {
        try {
          const diff = JSON.parse((event as MessageEvent<string>).data) as FleetDiff;
          if (diff && Array.isArray(diff.bins)) applyDiff(diff);
        } catch {
          // Ignore a malformed diff rather than corrupting bin state.
        }
      });

      // Server-side read failure — the route closes after sending this.
      source.addEventListener('error', () => {
        setConnected(false);
        // EventSource handles reconnection itself (with its own backoff); the
        // browser reopens the connection and we get a fresh snapshot.
      });
    };

    connect();

    return () => {
      disposed = true;
      useFleetStore.getState().setConnected(false);
      source?.close();
    };
  }, []);
}
