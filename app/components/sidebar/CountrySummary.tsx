'use client';

import { useEffect, useMemo, useState } from 'react';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import { useFleetStore } from '@/store/fleetStore';
import type { BinDetail } from '@/lib/types';
import { MetricRow } from '../ui/MetricRow';
import { StatusBadge } from '../ui/StatusBadge';

const ZONES = ['North', 'South', 'East', 'West'] as const;

export function CountrySummary() {
  const bins = useFleetStore((s) => s.bins);
  const selectedBinId = useFleetStore((s) => s.selectedBinId);
  const selectBin = useFleetStore((s) => s.selectBin);
  const [countries, setCountries] = useState<Record<string, string>>(() => Object.fromEntries(bins.map((b) => [b.id, approximateCountry(b.lat, b.lng)])));
  const [detail, setDetail] = useState<BinDetail | null>(null);

  useEffect(() => {
    if (!selectedBinId) return;
    const controller = new AbortController();
    fetch(`/api/bin/${encodeURIComponent(selectedBinId)}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: BinDetail) => setDetail(data))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setDetail(null); });
    return () => controller.abort();
  }, [selectedBinId]);

  useEffect(() => {
    let cancelled = false;
    const fallback = Object.fromEntries(bins.map((b) => [b.id, approximateCountry(b.lat, b.lng)]));
    setCountries(fallback);
    fetch('/world-countries.topo.json').then((r) => r.json()).then((topo) => {
      const geo: any = feature(topo, topo.objects.countries);
      const out: Record<string, string> = {};
      for (const b of bins) {
        const f = (geo.features ?? [geo]).find((x: any) => geoContains(x, [b.lng, b.lat]));
        out[b.id] = f?.properties?.name ?? fallback[b.id];
      }
      if (!cancelled) setCountries(out);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [bins]);

  const selected = bins.find((b) => b.id === selectedBinId);
  const country = selected ? countries[selected.id] : null;
  const members = country ? bins.filter((b) => countries[b.id] === country) : [];
  const total = members.reduce((n, b) => n + b.vehicle_count, 0);
  const fleet = bins.reduce((n, b) => n + b.vehicle_count, 0);
  const exceptions = members.reduce((n, b) => n + b.open_exceptions, 0);
  const zones = useMemo(() => zoneRollup(members, total), [members, total]);

  if (!country || !selected) return <div className="p-4 text-xs text-text-muted">Resolving country analytics…</div>;
  const bin = detail?.bin ?? selected;
  const binShare = fleet ? (bin.vehicle_count / fleet) * 100 : 0;

  return <div className="flex flex-col gap-5 p-4">
    <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wide text-text-muted">Country analytics</p><h2 className="text-base font-semibold text-text-primary">{country}</h2></div><button type="button" onClick={() => selectBin(null)} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted">Back to overview</button></div>
    <section className="rounded-lg border border-border bg-bg p-3"><MetricRow label="Open exceptions" value={`${exceptions} open`} hint={`· ${total ? (exceptions / total * 1000).toFixed(1) : '0.0'} per 1k`} /><MetricRow label="Share of fleet" value={`${fleet ? (total / fleet * 100).toFixed(1) : '0.0'}%`} hint={`· ${total.toLocaleString()} vehicles`} /></section>
    <section><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{country} zones</h3>{zones.map((z) => <div key={z.name} className="mb-3"><div className="flex justify-between text-xs"><span>{z.name}</span><span className="font-mono">{z.share.toFixed(1)}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${z.share}%` }} /></div><p className="mt-1 text-[10px] text-text-muted">{z.vehicles.toLocaleString()} vehicles · {z.vehicles ? (z.alerts / z.vehicles * 1000).toFixed(1) : '0.0'} alerts/1k</p></div>)}</section>
    <section className="border-t border-border pt-4"><p className="text-[10px] uppercase tracking-wide text-text-muted">Selected bin</p><div className="mt-1 flex items-end justify-between"><div><p className="text-3xl font-semibold tracking-tight text-text-primary">{bin.vehicle_count.toLocaleString()}</p><p className="text-xs text-text-muted">vehicles · Near {bin.region}</p></div><span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">{binShare.toFixed(1)}% of fleet</span></div><div className="mt-3 grid grid-cols-2 gap-2">{[["Vehicles", bin.vehicle_count.toLocaleString()], ["Avg SOH", `${bin.avg_soh.toFixed(1)}%`], ["Avg range remaining", `${Math.round(bin.avg_range_km ?? 0)} km`], ["Avg SOC", `${(bin.avg_soc ?? 0).toFixed(1)}%`], ["Degradation rate", `${(bin.avg_degradation_rate ?? 0).toFixed(1)}%/yr`], ["Energy spend today", `₹${(bin.energy_cost_today_inr ?? 0).toLocaleString()}`], ["Open exceptions", `${bin.open_exceptions} · ${bin.vehicle_count ? (bin.open_exceptions / bin.vehicle_count * 1000).toFixed(1) : '0.0'}/1k`], ["Share of fleet", `${binShare.toFixed(1)}%`]].map(([label, value]) => <div key={label} className="rounded-md border border-border bg-surface p-2"><p className="text-[10px] text-text-muted">{label}</p><p className="mt-1 font-mono text-sm tabular-nums text-text-primary">{value}</p></div>)}</div></section>
    <SocTrend detail={detail} />
    <VehicleSection detail={detail} />
  </div>;
}

function SocTrend({ detail }: { detail: BinDetail | null }) {
  const data = detail?.trend ?? [];
  if (data.length < 2) return <section className="border-t border-border pt-4"><p className="text-[10px] uppercase tracking-wide text-text-muted">24h avg SOC</p><p className="mt-3 text-xs text-text-muted">Loading trend…</p></section>;
  const width = 280, height = 88, pad = 8; const values = data.map((p) => p.avg_soc ?? p.avg_soh ?? 0); const min = Math.min(...values) - 1, max = Math.max(...values) + 1; const x = (i: number) => pad + (i / (data.length - 1)) * (width - pad * 2); const y = (v: number) => height - pad - ((v - min) / Math.max(1, max - min)) * (height - pad * 2); const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.avg_soc ?? p.avg_soh ?? 0)}`).join(' '); const area = `${line} L${x(data.length - 1)},${height - pad} L${x(0)},${height - pad} Z`;
  return <section className="border-t border-border pt-4"><div className="flex items-baseline justify-between"><p className="text-[10px] uppercase tracking-wide text-text-muted">24h avg SOC</p><span className="font-mono text-[10px] text-text-muted">{values[0].toFixed(0)}% → {values.at(-1)!.toFixed(0)}%</span></div><svg className="mt-2 h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24 hour average state of charge trend"><path d={area} fill="var(--color-accent)" fillOpacity=".12" /><path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></section>;
}

function VehicleSection({ detail }: { detail: BinDetail | null }) { return <section className="border-t border-border pt-4"><div className="flex items-baseline justify-between"><p className="text-[10px] uppercase tracking-wide text-text-muted">Vehicles</p><span className="text-[10px] text-text-muted">lowest charge first</span></div><p className="mt-1 font-mono text-xl text-text-primary">{detail?.vehicles.length ?? '…'}</p><div className="mt-2 flex flex-col">{(detail?.vehicles ?? []).map((v) => <div key={v.id} className="border-b border-border py-3"><div className="flex items-start justify-between gap-2"><div><p className="font-mono text-[11px] text-text-primary">{v.id}</p><p className="font-mono text-[10px] text-text-muted">{v.plate}</p></div><StatusBadge status={v.status} /></div><div className="mt-2 flex items-center justify-between text-[11px] text-text-muted"><span>{v.model}</span><span className="font-mono text-text-primary">{v.soc.toFixed(0)}%</span><span>{Math.round(v.range_km ?? 0)} km</span></div></div>)}</div></section>; }

function zoneRollup(members: typeof useFleetStore extends never ? never : any[], total: number) { if (!members.length) return []; const lat = members.reduce((n, b) => n + b.lat, 0) / members.length; const lng = members.reduce((n, b) => n + b.lng, 0) / members.length; return ZONES.map((name) => { const group = members.filter((b) => name === 'North' ? b.lat >= lat : name === 'South' ? b.lat < lat && b.lng >= lng : name === 'East' ? b.lat < lat && b.lng < lng : b.lat >= lat && b.lng < lng); const vehicles = group.reduce((n, b) => n + b.vehicle_count, 0); return { name, vehicles, alerts: group.reduce((n, b) => n + b.open_exceptions, 0), share: total ? vehicles / total * 100 : 0 }; }); }
function approximateCountry(lat: number, lng: number): string { if (lat >= 8 && lat <= 37 && lng >= 68 && lng <= 98) return 'India'; if (lat >= 23 && lat <= 38 && lng >= 60 && lng < 78) return 'Pakistan'; if (lat >= 18 && lat <= 30 && lng >= 97 && lng <= 106) return 'Myanmar'; if (lat >= 20 && lat <= 31 && lng >= 88 && lng < 93) return 'Bangladesh'; return 'Unknown'; }
