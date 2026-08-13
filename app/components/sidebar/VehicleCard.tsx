import type { CSSProperties } from 'react';
import type { Vehicle } from '@/lib/types';
import { StatusBadge } from '../ui/StatusBadge';
import { SOCBar } from '../ui/SOCBar';

// VehicleCard — one row of the virtualised list (agents.md §3, §8).
//
// PURE by design: no internal state, no hooks, no store reads. react-window
// recycles rows on every scroll frame, so any state or subscription here would
// cost a re-render per row per frame. All data arrives via props.

export const VEHICLE_ROW_HEIGHT = 64;

interface VehicleCardProps {
  vehicle: Vehicle;
  style?: CSSProperties;
}

export function VehicleCard({ vehicle, style }: VehicleCardProps) {
  return (
    <div style={style} className="px-4">
      <div className="flex h-16 flex-col justify-center gap-1 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] tabular-nums text-text-muted">
            {vehicle.id}
          </span>
          <span className="font-mono text-[10px] text-text-muted">{vehicle.plate}</span>
          <StatusBadge status={vehicle.status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-[11px] text-text-primary">
            {vehicle.model}
          </span>
          <SOCBar soc={vehicle.soc} />
          <span className="font-mono text-[10px] text-text-muted">{Math.round(vehicle.range_km ?? 0)} km</span>
        </div>
      </div>
    </div>
  );
}
