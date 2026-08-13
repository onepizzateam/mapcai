'use client';

import { useFleetStore } from '@/store/fleetStore';
import { RegionSummary } from './RegionSummary';
import { BinDetail } from './BinDetail';

// Sidebar — region summary ↔ bin detail, conditionally rendered on selection
// (agents.md §3). Only the selectedBinId scalar is read here, so switching views
// re-renders the sidebar subtree but never the D3 map subtree.

export function Sidebar() {
  const selectedBinId = useFleetStore((s) => s.selectedBinId);

  return (
    <aside
      className="flex h-full w-full flex-col overflow-y-auto bg-surface"
      aria-label="Fleet detail"
    >
      {selectedBinId ? <BinDetail /> : <RegionSummary />}
    </aside>
  );
}
