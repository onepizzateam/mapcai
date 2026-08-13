'use client';
import { useEffect, useMemo, useState } from 'react';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import { useFleetStore } from '@/store/fleetStore';
import { MetricRow } from '../ui/MetricRow';

const ZONES = ['North', 'South', 'East', 'West'] as const;
export function CountrySummary() {
  const bins = useFleetStore((s) => s.bins);
  const selectedBinId = useFleetStore((s) => s.selectedBinId);
  const selectBin = useFleetStore((s) => s.selectBin);
  const [countries, setCountries] = useState<Record<string, string>>(() => Object.fromEntries(bins.map((b) => [b.id, approximateCountry(b.lat, b.lng)])));
  useEffect(() => { let cancelled = false; const fallback = Object.fromEntries(bins.map((b) => [b.id, approximateCountry(b.lat, b.lng)])); setCountries(fallback); fetch('/world-countries.topo.json').then((r) => r.json()).then((topo) => { const geo: any = feature(topo, topo.objects.countries); const out: Record<string, string> = {}; for (const b of bins) { const f = (geo.features ?? [geo]).find((x: any) => geoContains(x, [b.lng, b.lat])); out[b.id] = f?.properties?.name ?? fallback[b.id]; } if (!cancelled) setCountries(out); }).catch(() => undefined); return () => { cancelled = true; }; }, [bins]);
  const selected = bins.find((b) => b.id === selectedBinId); const country = selected ? countries[selected.id] : null;
  const members = country ? bins.filter((b) => countries[b.id] === country) : []; const total = members.reduce((n, b) => n + b.vehicle_count, 0); const fleet = bins.reduce((n, b) => n + b.vehicle_count, 0); const exceptions = members.reduce((n, b) => n + b.open_exceptions, 0);
  const zones = useMemo(() => { if (!members.length) return []; const lat = members.reduce((n, b) => n + b.lat, 0) / members.length; const lng = members.reduce((n, b) => n + b.lng, 0) / members.length; return ZONES.map((name) => { const group = members.filter((b) => name === 'North' ? b.lat >= lat : name === 'South' ? b.lat < lat && b.lng >= lng : name === 'East' ? b.lat < lat && b.lng < lng : b.lat >= lat && b.lng < lng); const vehicles = group.reduce((n, b) => n + b.vehicle_count, 0); const alerts = group.reduce((n, b) => n + b.open_exceptions, 0); return { name, vehicles, alerts, share: total ? vehicles / total * 100 : 0 }; }); }, [members, total]);
  if (!country) return <div className="p-4 text-xs text-text-muted">Resolving country analytics…</div>;
  return <div className="flex flex-col gap-4 p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wide text-text-muted">Country analytics</p><h2 className="text-base font-semibold text-text-primary">{country}</h2></div><button type="button" onClick={() => selectBin(null)} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted">Back to overview</button></div><section><MetricRow label="Open exceptions" value={`${exceptions} open`} hint={`· ${total ? (exceptions / total * 1000).toFixed(1) : '0.0'} per 1k`} /><MetricRow label="Share of fleet" value={`${fleet ? (total / fleet * 100).toFixed(1) : '0.0'}%`} hint={`· ${total.toLocaleString()} vehicles`} /></section><section><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{country} zones</h3>{zones.map((z) => <div key={z.name} className="mb-3"><div className="flex justify-between text-xs"><span>{z.name}</span><span className="font-mono">{z.share.toFixed(1)}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${z.share}%` }} /></div><p className="mt-1 text-[10px] text-text-muted">{z.vehicles.toLocaleString()} vehicles · {z.vehicles ? (z.alerts / z.vehicles * 1000).toFixed(1) : '0.0'} alerts/1k</p></div>)}</section></div>;
}

function approximateCountry(lat: number, lng: number): string {
  if (lat >= 8 && lat <= 37 && lng >= 68 && lng <= 98) return 'India';
  if (lat >= 23 && lat <= 38 && lng >= 60 && lng < 78) return 'Pakistan';
  if (lat >= 18 && lat <= 30 && lng >= 97 && lng <= 106) return 'Myanmar';
  if (lat >= 20 && lat <= 31 && lng >= 88 && lng < 93) return 'Bangladesh';
  return 'Unknown';
}
