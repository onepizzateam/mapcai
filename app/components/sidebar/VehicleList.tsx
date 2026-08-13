'use client';

import { useMemo } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { Vehicle, VehicleStatus } from '@/lib/types';
import { VehicleCard, VEHICLE_ROW_HEIGHT } from './VehicleCard';

// VehicleList — virtualised list, SOC-ASCENDING (agents.md §3, §6).
//
// The sort order is an opinionated product decision, not a default: the most
// critical vehicles (lowest charge) surface first so the list doubles as a
// triage queue. The reference has no sort order at all.
//
// react-window FixedSizeList keeps scroll at 60fps regardless of list length;
// the row component is pure so recycling never triggers a subtree re-render.

interface VehicleListProps {
  vehicles: Vehicle[];
  statusFilter?: VehicleStatus | null;
  height?: number;
}

function Row({ index, style, data }: ListChildComponentProps<Vehicle[]>) {
  return <VehicleCard vehicle={data[index]} style={style} />;
}

export function VehicleList({ vehicles, statusFilter = null, height = 288 }: VehicleListProps) {
  const rows = useMemo(() => {
    const filtered = statusFilter
      ? vehicles.filter((v) => v.status === statusFilter)
      : vehicles;
    // Defensive re-sort: the API already returns SOC-ascending, but the list's
    // contract is "most critical first" regardless of source ordering.
    return [...filtered].sort((a, b) => a.soc - b.soc);
  }, [vehicles, statusFilter]);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-text-muted">
        {statusFilter
          ? `No ${statusFilter} vehicles in this bin — clear the status filter to see all.`
          : 'No vehicles reported for this bin yet.'}
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between px-4 pb-1">
        <h3 className="text-xs font-semibold text-text-primary">
          Vehicles · lowest charge first
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-text-muted">
          {rows.length}
        </span>
      </div>
      <FixedSizeList
        height={height}
        itemCount={rows.length}
        itemSize={VEHICLE_ROW_HEIGHT}
        width="100%"
        itemData={rows}
        itemKey={(index, data) => data[index].id}
        className="scrollbar-thin"
      >
        {Row}
      </FixedSizeList>
    </div>
  );
}
