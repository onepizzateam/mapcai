'use client';

import { useFleetStore } from '@/store/fleetStore';
import { projectPoint } from '@/lib/projection';
import type { GeoProjection } from 'd3-geo';
import type { RefObject } from 'react';

// HexTooltip — hover/focus tooltip (agents.md §3). Reads fleetStore.hoveredBin
// and positions an HTML card at the bin's projected pixel. Kept out of the SVG
// so text stays crisp and the D3 layer stays untouched.
//
// This reads reactive hover state (a scalar id), which is fine — the perf rule
// forbids React re-renders on the HEXBIN DATA tick, not on hover. Hover changes
// are user-paced and cheap.

interface HexTooltipProps {
  containerRef: RefObject<HTMLDivElement>;
  projection: GeoProjection | null;
}

export function HexTooltip({ projection }: HexTooltipProps) {
  const hoveredId = useFleetStore((s) => s.hoveredBinId);
  const bin = useFleetStore((s) =>
    s.hoveredBinId ? s.bins.find((b) => b.id === s.hoveredBinId) ?? null : null
  );

  if (!hoveredId || !bin || !projection) return null;

  const pt = projectPoint(projection, bin.lng, bin.lat);
  if (!pt) return null;

  const tooltipHeight = 120;
  const below = pt[1] - tooltipHeight < 0;
  const per1k =
    bin.vehicle_count > 0 ? (bin.open_exceptions / bin.vehicle_count) * 1000 : 0;

  return (
    <div
      role="tooltip"
      className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 shadow-md ${below ? 'translate-y-2' : '-translate-y-full -mt-2'}`}
      style={{ left: pt[0], top: pt[1] - 8 }}
    >
      <div className="text-xs font-semibold text-text-primary">{bin.region}</div>
      <div className="mt-0.5 font-mono text-[11px] text-text-muted">{bin.id}</div>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-text-muted">Vehicles</dt>
        <dd className="text-right font-mono text-text-primary">{bin.vehicle_count.toLocaleString()}</dd>
        <dt className="text-text-muted">Avg SOH</dt>
        <dd className="text-right font-mono text-text-primary">{bin.avg_soh.toFixed(0)}%</dd>
        <dt className="text-text-muted">Avg SOC</dt>
        <dd className="text-right font-mono text-text-primary">{(bin.avg_soc ?? 0).toFixed(1)}%</dd>
        <dt className="text-text-muted">Exceptions</dt>
        <dd className="text-right font-mono text-text-primary">
          {bin.open_exceptions} · {per1k.toFixed(1)}/1k
        </dd>
      </dl>
    </div>
  );
}
