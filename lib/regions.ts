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
] as const;

export const REGION_NAMES: readonly RegionName[] = HOTSPOTS.map((h) => h.region);

/** India geographic bounds — a guard so scattered bins stay on-shore-ish. */
export const INDIA_BOUNDS = {
  minLat: 8.0,
  maxLat: 35.5,
  minLng: 68.0,
  maxLng: 97.5,
} as const;
