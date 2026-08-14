'use client';

import type { HexDatum } from '@/lib/hexbin';
import { getFleetState, useFleetStore } from '@/store/fleetStore';
import { MetricRow } from '../ui/MetricRow';

export function HexDetail({ hex }: { hex: HexDatum }) {
  const selectHex = useFleetStore((s) => s.selectHex);
  const ranked = [...hex.bins].sort((a, b) => (a.avg_soc ?? 0) - (b.avg_soc ?? 0));

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div>
          <h2 className="font-mono text-xl tabular-nums text-text-primary">{hex.vehicle_count.toLocaleString()}</h2>
          <p className="text-xs text-text-muted">{hex.bins.length} areas</p>
        </div>
        <button type="button" onClick={() => { selectHex(null); getFleetState().selectBin(null); }} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary">
          Back to regions
        </button>
      </div>
      <section className="border-b border-border p-4">
        <MetricRow label="Avg SOC" value={`${hex.avg_soc.toFixed(1)}%`} />
        <MetricRow label="Avg SOH" value={`${hex.avg_soh.toFixed(1)}%`} />
        <MetricRow label="Avg range" value={`${Math.round(hex.avg_range_km)} km`} />
        <MetricRow label="Open exceptions" value={hex.open_exceptions} />
        <MetricRow label="Stranded" value={hex.stranded_count ?? 0} />
      </section>
      <section className="p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Areas</h3>
        <div className="flex flex-col">
          {ranked.map((bin) => {
            const soc = bin.avg_soc ?? 0;
            const color = soc < 20 ? 'var(--color-soc-critical)' : soc < 50 ? 'var(--color-soc-low)' : 'var(--color-soc-ok)';
            const per1k = bin.alerts_per_1k ?? (bin.vehicle_count ? (bin.open_exceptions / bin.vehicle_count) * 1000 : 0);
            return (
              <button key={bin.id} type="button" onClick={() => getFleetState().selectBin(bin.id)} className="flex items-center justify-between gap-2 border-b border-border py-3 text-left hover:bg-bg">
                <span className="min-w-0 flex-1 truncate">
                  <span className="block text-xs text-text-primary">{bin.region || 'Unknown area'}</span>
                  <span className="block font-mono text-[10px] text-text-muted">
                    {bin.lat.toFixed(3)}, {bin.lng.toFixed(3)}
                  </span>
                </span>
                <span className="whitespace-nowrap text-[11px]" style={{ color }}><span aria-hidden="true">●</span> {soc.toFixed(0)}%</span>
                <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-text-primary">{bin.vehicle_count.toLocaleString()}</span>
                <span className="whitespace-nowrap text-[10px] text-text-muted">{per1k.toFixed(1)}/1k</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
