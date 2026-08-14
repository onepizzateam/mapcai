'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HexDatum } from '@/lib/hexbin';
import type { BinDetail, BinSummary, TrendPoint } from '@/lib/types';
import { getFleetState, useFleetStore } from '@/store/fleetStore';
import { MetricRow } from '../ui/MetricRow';

const ZONES = ['North', 'South', 'East', 'West'] as const;

export function HexDetail({ hex }: { hex: HexDatum }) {
  const selectHex = useFleetStore((s) => s.selectHex);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const memberKey = hex.bins.map((b) => b.id).join(',');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(hex.bins.map((bin) => fetch(`/api/bin/${encodeURIComponent(bin.id)}`, { signal: controller.signal }).then((r) => r.ok ? r.json() as Promise<BinDetail> : null).catch(() => null)))
      .then((details) => setTrends(weightedTrend(hex.bins, details.filter((d): d is BinDetail => Boolean(d)))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [memberKey]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(hex.bins.map(async (bin) => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${bin.lat}&lon=${bin.lng}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        const data = await r.json();
        const a = data.address ?? {};
        return [bin.id, a.suburb ?? a.town ?? a.village ?? a.municipality ?? a.county ?? bin.region ?? `${bin.lat.toFixed(3)}, ${bin.lng.toFixed(3)}`] as const;
      } catch { return [bin.id, bin.region || `${bin.lat.toFixed(3)}, ${bin.lng.toFixed(3)}`] as const; }
    })).then((entries) => setPlaceNames(Object.fromEntries(entries))).catch(() => undefined);
    return () => controller.abort();
  }, [memberKey]);

  const aggregate = useMemo(() => weightedAggregate(hex.bins), [memberKey]);
  const zones = useMemo(() => zoneRollup(hex.bins), [memberKey]);
  const ranked = [...hex.bins].sort((a, b) => (a.avg_soc ?? 0) - (b.avg_soc ?? 0));
  const fleet = useFleetStore((s) => s.bins).reduce((n, b) => n + b.vehicle_count, 0);
  const share = fleet ? aggregate.vehicle_count / fleet * 100 : 0;

  return <div className="flex flex-col gap-5 p-4">
    <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wide text-text-muted">Country analytics</p><h2 className="text-base font-semibold text-text-primary">{approximateCountry(hex.bins[0]?.lat ?? 0, hex.bins[0]?.lng ?? 0)}</h2></div><button type="button" onClick={() => { selectHex(null); getFleetState().selectBin(null); }} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted">Back to overview</button></div>
    <section className="rounded-lg border border-border bg-bg p-3"><MetricRow label="Open exceptions" value={`${aggregate.open_exceptions} open`} hint={`· ${aggregate.vehicle_count ? (aggregate.open_exceptions / aggregate.vehicle_count * 1000).toFixed(1) : '0.0'} per 1k`} /><MetricRow label="Share of fleet" value={`${share.toFixed(1)}%`} hint={`· ${aggregate.vehicle_count.toLocaleString()} vehicles`} /></section>
    <section><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Country zones</h3>{zones.map((z) => <div key={z.name} className="mb-3"><div className="flex justify-between text-xs"><span>{z.name}</span><span className="font-mono">{z.share.toFixed(1)}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${z.share}%` }} /></div><p className="mt-1 text-[10px] text-text-muted">{z.vehicles.toLocaleString()} vehicles · {z.vehicles ? (z.alerts / z.vehicles * 1000).toFixed(1) : '0.0'} alerts/1k</p></div>)}</section>
    <section className="border-t border-border pt-4"><p className="text-[10px] uppercase tracking-wide text-text-muted">Selected hex</p><div className="mt-1 flex items-end justify-between"><div><p className="text-3xl font-semibold tracking-tight text-text-primary">{aggregate.vehicle_count.toLocaleString()}</p><p className="text-xs text-text-muted">vehicles · {hex.bins.length} areas</p></div><span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">{share.toFixed(1)}% of fleet</span></div><div className="mt-3 grid grid-cols-2 gap-2">{[["Vehicles", aggregate.vehicle_count.toLocaleString()], ["Avg SOH", `${aggregate.avg_soh.toFixed(1)}%`], ["Avg range remaining", `${Math.round(aggregate.avg_range_km)} km`], ["Avg SOC", `${aggregate.avg_soc.toFixed(1)}%`], ["Degradation rate", `${aggregate.avg_degradation_rate.toFixed(1)}%/yr`], ["Energy spend today", `₹${aggregate.energy_cost_today_inr.toLocaleString()}`], ["Open exceptions", `${aggregate.open_exceptions} · ${aggregate.vehicle_count ? (aggregate.open_exceptions / aggregate.vehicle_count * 1000).toFixed(1) : '0.0'}/1k`], ["Share of fleet", `${share.toFixed(1)}%`]].map(([label, value]) => <div key={label} className="rounded-md border border-border bg-surface p-2"><p className="text-[10px] text-text-muted">{label}</p><p className="mt-1 font-mono text-sm tabular-nums text-text-primary">{value}</p></div>)}</div></section>
    <SocTrend data={trends} />
    <section className="border-t border-border pt-4"><p className="text-[10px] uppercase tracking-wide text-text-muted">Areas</p><div className="mt-2 flex flex-col">{ranked.map((bin) => <button key={bin.id} type="button" onClick={() => getFleetState().selectBin(bin.id)} className="flex items-center justify-between gap-2 border-b border-border py-3 text-left hover:bg-bg"><span className="min-w-0 flex-1 truncate"><span className="block text-xs text-text-primary">Near {placeNames[bin.id] || bin.region || `${bin.lat.toFixed(3)}, ${bin.lng.toFixed(3)}`}</span><span className="block text-[10px] text-text-muted">avg SOC - {(bin.avg_soc ?? 0).toFixed(1)}%</span></span><span className="font-mono text-[11px] tabular-nums">{bin.vehicle_count.toLocaleString()}</span></button>)}</div></section>
  </div>;
}

function weightedAggregate(bins: BinSummary[]) { const vehicleCount = bins.reduce((n, b) => n + b.vehicle_count, 0); const denominator = vehicleCount || 1; const avg = (key: keyof BinSummary) => bins.reduce((n, b) => n + Number(b[key] ?? 0) * b.vehicle_count, 0) / denominator; return { vehicle_count: vehicleCount, open_exceptions: bins.reduce((n, b) => n + b.open_exceptions, 0), avg_soh: avg('avg_soh'), avg_soc: avg('avg_soc'), avg_range_km: avg('avg_range_km'), avg_degradation_rate: avg('avg_degradation_rate'), energy_cost_today_inr: avg('energy_cost_today_inr') }; }
function weightedTrend(bins: BinSummary[], details: BinDetail[]) { const byHour = new Map<number, { sum: number; weight: number }>(); details.forEach((d) => { const b = bins.find((x) => x.id === d.bin.id); if (!b) return; d.trend.forEach((p) => { const value = p.avg_soc ?? p.avg_soh ?? 0; const row = byHour.get(p.hour) ?? { sum: 0, weight: 0 }; row.sum += value * b.vehicle_count; row.weight += b.vehicle_count; byHour.set(p.hour, row); }); }); return [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, avg_soc: v.weight ? v.sum / v.weight : 0 })); }
function zoneRollup(bins: BinSummary[]) { const lat = bins.reduce((n, b) => n + b.lat, 0) / Math.max(1, bins.length); const lng = bins.reduce((n, b) => n + b.lng, 0) / Math.max(1, bins.length); const total = bins.reduce((n, b) => n + b.vehicle_count, 0) || 1; return ZONES.map((name) => { const group = bins.filter((b) => name === 'North' ? b.lat >= lat : name === 'South' ? b.lat < lat && b.lng >= lng : name === 'East' ? b.lat < lat && b.lng < lng : b.lat >= lat && b.lng < lng); const vehicles = group.reduce((n, b) => n + b.vehicle_count, 0); return { name, vehicles, alerts: group.reduce((n, b) => n + b.open_exceptions, 0), share: vehicles / total * 100 }; }); }
function SocTrend({ data }: { data: TrendPoint[] }) { if (data.length < 2) return <section className="border-t border-border pt-4"><p className="text-[10px] uppercase tracking-wide text-text-muted">24h avg SOC</p><p className="mt-3 text-xs text-text-muted">Loading trend…</p></section>; const width = 280, height = 88, pad = 8; const values = data.map((p) => p.avg_soc ?? 0); const min = Math.min(...values) - 1, max = Math.max(...values) + 1; const x = (i: number) => pad + i / (data.length - 1) * (width - pad * 2); const y = (v: number) => height - pad - (v - min) / Math.max(1, max - min) * (height - pad * 2); const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.avg_soc ?? 0)}`).join(' '); return <section className="border-t border-border pt-4"><div className="flex items-baseline justify-between"><p className="text-[10px] uppercase tracking-wide text-text-muted">24h avg SOC</p><span className="font-mono text-[10px] text-text-muted">{values[0].toFixed(0)}% → {values.at(-1)!.toFixed(0)}%</span></div><svg className="mt-2 h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24 hour weighted average state of charge trend"><path d={`${line} L${x(data.length - 1)},${height - pad} L${x(0)},${height - pad} Z`} fill="var(--color-accent)" fillOpacity=".12" /><path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></section>; }
function approximateCountry(lat: number, lng: number) { return lat >= 8 && lat <= 37 && lng >= 68 && lng <= 98 ? 'India' : 'Selected country'; }
