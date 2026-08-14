'use client';
import { useFleetStore } from '@/store/fleetStore';
import { projectPoint } from '@/lib/projection';
import type { GeoProjection } from 'd3-geo';
export function HexTooltip({ projection }: { containerRef: React.RefObject<HTMLDivElement>; projection: GeoProjection | null }) {
  const hex = useFleetStore((s) => s.hoveredHex);
  if (!hex || !projection) return null;
  const pt = projectPoint(projection, hex.bins.reduce((n, b) => n + b.lng * b.vehicle_count, 0) / Math.max(1, hex.vehicle_count), hex.bins.reduce((n, b) => n + b.lat * b.vehicle_count, 0) / Math.max(1, hex.vehicle_count));
  if (!pt) return null;
  const per1k = hex.vehicle_count ? hex.open_exceptions / hex.vehicle_count * 1000 : 0;
  return <div role="tooltip" className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 shadow-md" style={{ left: pt[0], top: pt[1] - 8 }}><div className="text-xs font-semibold text-text-primary">Selected hex</div><div className="mt-0.5 font-mono text-[11px] text-text-muted">{hex.bins.length} areas</div><dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[11px]"><dt className="text-text-muted">Vehicles</dt><dd className="text-right font-mono">{hex.vehicle_count.toLocaleString()}</dd><dt className="text-text-muted">Avg SOH</dt><dd className="text-right font-mono">{hex.avg_soh.toFixed(1)}%</dd><dt className="text-text-muted">Avg SOC</dt><dd className="text-right font-mono">{hex.avg_soc.toFixed(1)}%</dd><dt className="text-text-muted">Exceptions</dt><dd className="text-right font-mono">{hex.open_exceptions} · {per1k.toFixed(1)}/1k</dd></dl></div>;
}
