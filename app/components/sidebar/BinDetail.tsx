'use client';

import { useEffect, useState } from 'react';
import { useFleetStore, selectSelectedBin } from '@/store/fleetStore';
import type { BinDetail as BinDetailPayload } from '@/lib/types';
import { MetricRow } from '../ui/MetricRow';
import { TrendSparkline } from './TrendSparkline';
import { VehicleList } from './VehicleList';

// BinDetail — the drill-down view (agents.md §3). Bin summary numbers come from
// the store (already in memory from /api/bins); the heavy payload — vehicle list
// and 24h trend — is fetched LAZILY from /api/bin/:id on select, matching the
// "vehicle lists and trend data are fetched lazily on bin select" contract
// (agents.md §2). One request per selection, aborted if the selection changes.

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function BinDetail() {
  const bin = useFleetStore(selectSelectedBin);
  const selectedBinId = useFleetStore((s) => s.selectedBinId);
  const statusFilter = useFleetStore((s) => s.filters.status);
  const selectBin = useFleetStore((s) => s.selectBin);

  const [detail, setDetail] = useState<BinDetailPayload | null>(null);
  const [state, setState] = useState<LoadState>('idle');

  useEffect(() => {
    if (!selectedBinId) {
      setDetail(null);
      setState('idle');
      return;
    }

    const controller = new AbortController();
    setState('loading');

    fetch(`/api/bin/${encodeURIComponent(selectedBinId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<BinDetailPayload>;
      })
      .then((data) => {
        setDetail(data);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState('error');
      });

    return () => controller.abort();
  }, [selectedBinId]);

  if (!bin) return null;

  const per1k = bin.alerts_per_1k ?? (bin.vehicle_count > 0 ? (bin.open_exceptions / bin.vehicle_count) * 1000 : 0);

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{bin.region}</p>
          <h2 className="font-mono text-sm text-text-primary">{bin.id}</h2>
          <p className="font-mono text-[10px] tabular-nums text-text-muted">
            {bin.lat.toFixed(3)}, {bin.lng.toFixed(3)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => selectBin(null)}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Back to regions
        </button>
      </div>

      <section className="border-b border-border p-4">
        <p className="mb-3 text-xs font-semibold text-text-primary">⚠ {bin.stranded_count ?? 0} stranded · {bin.critical_soc_count ?? 0} critical SOC · {bin.vehicle_count.toLocaleString()} vehicles</p>
        <MetricRow label="Vehicles in bin" value={bin.vehicle_count.toLocaleString()} />
        <MetricRow label="Avg range remaining" value={`${Math.round(bin.avg_range_km ?? 0)} km`} />
        <MetricRow label="Avg SOC" value={`${(bin.avg_soc ?? 0).toFixed(0)}%`} />
        <MetricRow label="Average SOH" value={`${bin.avg_soh.toFixed(1)}%`} />
        <MetricRow label="Degradation rate" value={`${(bin.avg_degradation_rate ?? 0).toFixed(1)}%/yr`} />
        <MetricRow label="Energy spend today" value={`₹${(bin.energy_cost_today_inr ?? 0).toLocaleString()}`} />
        <MetricRow
          label="Open exceptions"
          value={`${bin.open_exceptions} open`}
          hint={`· ${per1k.toFixed(1)} per 1k vehicles`}
        />
      </section>

      <section className="border-b border-border p-4">
        {state === 'ready' && detail ? (
          <TrendSparkline data={detail.trend} />
        ) : state === 'error' ? (
          <p className="text-[11px] text-text-muted">
            Trend unavailable · reselect the hex to retry
          </p>
        ) : (
          <p className="text-[11px] text-text-muted">Loading 24h trend…</p>
        )}
      </section>

      <section className="pt-3">
        {state === 'ready' && detail ? (
          <VehicleList vehicles={detail.vehicles} statusFilter={statusFilter} />
        ) : state === 'error' ? (
          <p className="px-4 text-xs text-text-muted">
            Couldn&apos;t load vehicles · reselect the hex to retry
          </p>
        ) : (
          <p className="px-4 text-xs text-text-muted">Loading vehicles…</p>
        )}
      </section>
    </div>
  );
}
