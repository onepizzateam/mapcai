'use client';

import { useFleetStore } from '@/store/fleetStore';
import { LivePulse } from '../ui/LivePulse';


// Topbar — title, headline fleet metric, and the live-feed indicator
// (agents.md §3 shell). Reads only scalar rollups from the store.

export function Topbar() {
  const total = useFleetStore((s) => s.totalVehicles);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-sm font-semibold text-text-primary">Fleet Console</h1>
        <span className="hidden text-xs text-text-muted sm:inline">
          Real-time EV fleet health
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-baseline gap-1 sm:flex">
          <span className="font-mono text-sm tabular-nums text-text-primary">
            {total ? total.toLocaleString() : '—'}
          </span>
          <span className="text-xs text-text-muted">vehicles</span>
        </div>
        <LivePulse />
      </div>
    </header>
  );
}
