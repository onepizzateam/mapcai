'use client';

import { useEffect, useState } from 'react';
import { useFleetStore, selectSelectedBin, getFleetState } from '@/store/fleetStore';
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
  const selectCountry = useFleetStore((s) => s.selectCountry);

  const [detail, setDetail] = useState<BinDetailPayload | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [locationLabel, setLocationLabel] = useState('');

  useEffect(() => {
    if (!bin) return;
    const controller = new AbortController();
    const fallback = `${bin.lat.toFixed(3)}, ${bin.lng.toFixed(3)}`;
    setLocationLabel(fallback);
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const url = token
      ? `https://api.mapbox.com/geocoding/v5/mapbox.places/${bin.lng},${bin.lat}.json?types=place,region&limit=1&access_token=${encodeURIComponent(token)}`
      : `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${bin.lat}&lon=${bin.lng}`;
    fetch(url, { signal: controller.signal, headers: token ? undefined : { Accept: 'application/json' } })
      .then((res) => res.json())
      .then((data) => setLocationLabel(token ? data.features?.[0]?.place_name ?? fallback : data.display_name ?? fallback))
      .catch(() => undefined);
    return () => controller.abort();
  }, [bin]);

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
          <p className="text-xs uppercase tracking-wide text-text-muted">Near {locationLabel}</p>
          <h2 className="font-mono text-sm text-text-primary">{bin.id}</h2>
          <p className="font-mono text-[10px] tabular-nums text-text-muted">
            {bin.lat.toFixed(3)}, {bin.lng.toFixed(3)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            selectBin(null);
            const hex = getFleetState().selectedHex;
            if (!hex || hex.bins.length <= 1) selectCountry(bin.country ?? null);
          }}
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
        <MetricRow label="Charger utilization" value={`${(bin.charger_utilization_pct ?? 0).toFixed(1)}%`} />
        <MetricRow label="Fleet efficiency" value={`${(bin.avg_efficiency_km_per_kwh ?? 0).toFixed(2)} km/kWh`} />
        <MetricRow label="Cost per km" value={`₹${(bin.avg_cost_per_km_inr ?? 0).toFixed(2)}`} />
        <MetricRow label="Triage estimate" value={`${bin.near_strand_count ?? 0} vehicles <30 min from strand`} />
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
