// Shared domain types. Not in agents.md §3 file list, but added deliberately:
// the same shapes cross the API routes, the Zustand store, the seeder and the
// D3 layer, so a single typed source prevents drift. Keeping it in lib/ (not a
// new top-level dir) stays within the spec's structure.

export type VehicleStatus = 'driving' | 'charging' | 'parked';

export type RegionName =
  | 'Delhi NCR'
  | 'Mumbai'
  | 'Bangalore'
  | 'Hyderabad'
  | 'Chennai'
  | 'Pune'
  | 'Surat'
  | 'Ahmedabad';

/** One hex bin summary — mirrors Redis hash fleet:bin:{id}. */
export interface BinSummary {
  id: string;
  lat: number;
  lng: number;
  vehicle_count: number;
  avg_soh: number; // 0..100 (percent)
  open_exceptions: number;
  region: RegionName;
}

/** One vehicle — mirrors Redis hash fleet:vehicle:{id}. */
export interface Vehicle {
  id: string;
  model: string;
  soc: number; // 0..100 (percent)
  status: VehicleStatus;
  soh: number; // 0..100 (percent)
  bin: string;
  lat: number;
  lng: number;
}

/** One 24h trend sample — decoded from SortedSet fleet:region:{name}:trend. */
export interface TrendPoint {
  hour: number; // hour-epoch (score)
  avg_soh: number; // member
}

/** Region rollup — mirrors Redis hash fleet:region:{name}:summary. */
export interface RegionSummary {
  name: RegionName;
  vehicle_count: number;
  alerts_per_1k: number;
  share_pct: number;
}

/** Lazy bin-detail payload returned by GET /api/bin/[id]. */
export interface BinDetail {
  bin: BinSummary;
  vehicles: Vehicle[]; // SOC-ascending (most critical first)
  trend: TrendPoint[];
}

/** Full snapshot returned by GET /api/bins. */
export interface BinsSnapshot {
  bins: BinSummary[];
  regions: RegionSummary[];
  meta: { total_vehicles: number; last_updated: number };
}

/** A single bin mutation produced by /api/writer, consumed by the SSE reader. */
export interface BinDiff {
  id: string;
  vehicle_count: number;
  avg_soh: number;
  open_exceptions: number;
}

/** The diff document at fleet:latest:diff (30s TTL). */
export interface FleetDiff {
  ts: number; // mutation timestamp — doubles as the ETag
  bins: BinDiff[];
}

/** Colour-encoding mode toggled from the legend (agents.md §1, §6). */
export type ViewMode = 'combined' | 'health' | 'density';
