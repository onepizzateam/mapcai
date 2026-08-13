'use client';

import { useEffect } from 'react';
import { useFleetStore } from './fleetStore';
import type { BinsSnapshot } from '@/lib/types';

// Initial snapshot bootstrap: GET /api/bins → store.setSnapshot (agents.md §3).
//
// One fetch on mount. Deliberately does NOT import the faker generator — that
// would pull the seed module into the client bundle and blow the 120KB budget
// (agents.md §8). The seeded data reaches the browser only via Redis + /api/bins.
//
// Live updates are handled separately by useSSEStream, whose first SSE event is
// also a full snapshot; this fetch just avoids waiting on the stream handshake.

export function useFleetData(): void {
  useEffect(() => {
    const controller = new AbortController();
    const setDataError = useFleetStore.getState().setDataError;

    fetch('/api/bins', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<BinsSnapshot>;
      })
      .then((snap) => {
        useFleetStore.getState().setSnapshot({
          bins: snap.bins,
          regions: snap.regions,
          total_vehicles: snap.meta.total_vehicles,
          last_updated: snap.meta.last_updated,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setDataError('Fleet data is unavailable. Check Redis configuration or run the seed command.');
      });

    return () => controller.abort();
  }, []);
}
