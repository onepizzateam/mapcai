'use client';
import { useFleetStore } from '@/store/fleetStore';
import { MetricRow } from '../ui/MetricRow';

export function CountrySummary() {
  const country = useFleetStore((s) => s.selectedCountry)!;
  const bins = useFleetStore((s) => s.bins).filter((b) => b.country === country);
  const selectCountry = useFleetStore((s) => s.selectCountry);
  const selectBin = useFleetStore((s) => s.selectBin);
  const total = bins.reduce((n, b) => n + b.vehicle_count, 0);
  const exceptions = bins.reduce((n, b) => n + b.open_exceptions, 0);
  const stranded = bins.reduce((n, b) => n + (b.stranded_count ?? 0), 0);
  const soh = total ? bins.reduce((n, b) => n + b.avg_soh * b.vehicle_count, 0) / total : 0;
  const groups = Array.from(new Map(bins.map((b) => [b.region, b])).values());
  return <div className="flex flex-col gap-4 p-4"><div className="flex items-center justify-between"><button className="text-xs text-accent" onClick={() => selectCountry(null)}>← Back to overview</button><span className="text-xs text-text-muted">{country}</span></div><section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{country} fleet</h2><MetricRow label="Vehicles tracked" value={total.toLocaleString()} /><MetricRow label="Average SOH" value={`${soh.toFixed(1)}%`} /><MetricRow label="Open exceptions" value={`${exceptions} open`} hint={`· ${total ? ((exceptions / total) * 1000).toFixed(1) : '0.0'} per 1k`} /><MetricRow label="Vehicles near strand" value={`${stranded} vehicles below 30 min`} /></section><section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Regions / hotspots</h2><ul className="flex flex-col gap-2">{groups.map((b) => <li key={b.id}><button className="w-full rounded-md border border-transparent px-2 py-2 text-left hover:border-border hover:bg-bg" onClick={() => selectBin(b.id)}><div className="flex justify-between text-xs"><span>{b.region}</span><span className="font-mono">{b.vehicle_count.toLocaleString()}</span></div><div className="mt-1 text-[10px] text-text-muted">{b.open_exceptions} open · {b.avg_soh.toFixed(1)}% SOH</div></button></li>)}</ul></section></div>;
}
