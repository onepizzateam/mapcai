import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Topology } from 'topojson-specification';
import type { BinSummary } from '@/lib/types';

let countries: any[] | null = null;
function getCountries() {
  if (!countries) {
    const topo = JSON.parse(readFileSync(join(process.cwd(), 'public/world-countries.topo.json'), 'utf8')) as Topology;
    const geo = feature(topo, topo.objects.countries as any) as any;
    countries = geo.features ?? [geo];
  }
  return countries ?? [];
}
export function resolveCountry(lat: number, lng: number): string {
  const found = getCountries().find((f) => geoContains(f, [lng, lat]));
  return String(found?.properties?.name ?? 'Unknown');
}
export function resolveBinCountries(bins: BinSummary[]): BinSummary[] {
  return bins.map((bin) => ({ ...bin, country: bin.country || resolveCountry(bin.lat, bin.lng) }));
}
