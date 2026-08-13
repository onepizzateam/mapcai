import type { RegionName } from './types';

// Real EV hotspots the fleet clusters around (agents.md §2 seeder spec).
// Shared by the seeder and the Phase-1 static hexbin layer so the hardcoded
// demo bins line up with the seeded data. Not in §3's file list, but a single
// source for these constants prevents the map and seed drifting apart.

export interface Hotspot {
  region: RegionName;
  lat: number;
  lng: number;
  /** Relative weight — bigger metros carry more of the 25k fleet. */
  weight: number;
}

export const HOTSPOTS: readonly Hotspot[] = [
  { region: 'Delhi NCR', lat: 28.6139, lng: 77.209, weight: 1.0 },
  { region: 'Mumbai', lat: 19.076, lng: 72.8777, weight: 0.95 },
  { region: 'Bangalore', lat: 12.9716, lng: 77.5946, weight: 0.9 },
  { region: 'Hyderabad', lat: 17.385, lng: 78.4867, weight: 0.75 },
  { region: 'Chennai', lat: 13.0827, lng: 80.2707, weight: 0.7 },
  { region: 'Pune', lat: 18.5204, lng: 73.8567, weight: 0.6 },
  { region: 'Surat', lat: 21.1702, lng: 72.8311, weight: 0.45 },
  { region: 'Ahmedabad', lat: 23.0225, lng: 72.5714, weight: 0.5 },
  { region: 'Dubai', lat: 25.2048, lng: 55.2708, weight: 0.7 },
  { region: 'Singapore', lat: 1.3521, lng: 103.8198, weight: 0.65 },
  { region: 'London', lat: 51.5072, lng: -0.1276, weight: 0.8 },
  { region: 'São Paulo', lat: -23.5505, lng: -46.6333, weight: 0.75 },
] as const;

export const REGION_NAMES: readonly RegionName[] = HOTSPOTS.map((h) => h.region);

export const REGION_BOUNDS: Record<RegionName, { latMin: number; latMax: number; lngMin: number; lngMax: number }> = {
  'Delhi NCR': { latMin: 28.40, latMax: 28.88, lngMin: 76.84, lngMax: 77.55 },
  Mumbai: { latMin: 18.89, latMax: 19.27, lngMin: 72.77, lngMax: 73.10 },
  Bangalore: { latMin: 12.83, latMax: 13.18, lngMin: 77.46, lngMax: 77.78 },
  Hyderabad: { latMin: 17.27, latMax: 17.56, lngMin: 78.27, lngMax: 78.63 },
  Chennai: { latMin: 12.90, latMax: 13.23, lngMin: 80.10, lngMax: 80.33 },
  Pune: { latMin: 18.42, latMax: 18.62, lngMin: 73.76, lngMax: 73.97 },
  Surat: { latMin: 21.10, latMax: 21.28, lngMin: 72.77, lngMax: 72.93 },
  Ahmedabad: { latMin: 22.95, latMax: 23.13, lngMin: 72.49, lngMax: 72.68 },
  Dubai: { latMin: 25.04, latMax: 25.35, lngMin: 55.10, lngMax: 55.55 },
  Singapore: { latMin: 1.24, latMax: 1.46, lngMin: 103.68, lngMax: 103.95 },
  London: { latMin: 51.38, latMax: 51.62, lngMin: -0.35, lngMax: 0.15 },
  'São Paulo': { latMin: -23.72, latMax: -23.43, lngMin: -46.82, lngMax: -46.37 },
};

/** India geographic bounds — a guard so scattered bins stay on-shore-ish. */
export const INDIA_BOUNDS = {
  minLat: 8.0,
  maxLat: 35.5,
  minLng: 68.0,
  maxLng: 97.5,
} as const;
