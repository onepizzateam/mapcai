// Shared domain types. Not in agents.md §3 file list, but added deliberately:
// the same shapes cross the API routes, the Zustand store, the seeder and the
// D3 layer, so a single typed source prevents drift. Keeping it in lib/ (not a
// new top-level dir) stays within the spec's structure.

export type VehicleStatus = 'driving' | 'charging' | 'parked' | 'stranded';
export type ChargeType = 'AC_slow' | 'DC_fast' | 'none';
export type ThermalStatus = 'normal' | 'elevated' | 'critical';
export type ExceptionType = 'thermal' | 'charging_fault' | 'gps_dropout' | 'low_soh' | 'low_soc';

/* Region labels are resolved from coordinates at query/render time. */

/** One hex bin summary — mirrors Redis hash fleet:bin:{id}. */
export interface BinSummary {
  id: string;
  lat: number;
  lng: number;
  vehicle_count: number;
  avg_soc?: number;
  avg_soh: number; // 0..100 (percent)
  avg_range_km?: number;
  stranded_count?: number;
  critical_soc_count?: number;
  charging_count?: number;
  driving_count?: number;
  parked_count?: number;
  avg_degradation_rate?: number;
  energy_cost_today_inr?: number;
  charger_utilization_pct?: number;
  open_exceptions: number;
  alerts_per_1k?: number;
  region: string;
  country?: string;
  avg_efficiency_km_per_kwh?: number;
  avg_cost_per_km_inr?: number;
  near_strand_count?: number;
}

/** One vehicle — mirrors Redis hash fleet:vehicle:{id}. */
export interface Vehicle {
  id: string;
  plate?: string;
  model: string;
  soc: number; // 0..100 (percent)
  status: VehicleStatus;
  soh: number; // 0..100 (percent)
  degradation_rate?: number;
  range_km?: number;
  rated_range_km?: number;
  energy_consumed_kwh?: number;
  energy_cost_inr?: number;
  last_charge_duration_min?: number;
  charge_type?: ChargeType;
  thermal_status?: ThermalStatus;
  trips_today?: number;
  km_today?: number;
  uptime_pct?: number;
  exception_type?: ExceptionType;
  bin_id?: string;
  bin?: string;
  lat: number;
  lng: number;
}

/** One 24h trend sample — decoded from SortedSet fleet:region:{name}:trend. */
export interface TrendPoint {
  hour: number; // hour-epoch (score)
  avg_soc?: number; // member
  avg_soh?: number; // legacy compatibility for existing fixtures
}

/** Region rollup — mirrors Redis hash fleet:region:{name}:summary. */
export interface RegionSummary {
  name: string;
  vehicle_count: number;
  alerts_per_1k: number;
  stranded_count?: number;
  charging_count?: number;
  energy_cost_today_inr?: number;
  share_pct: number;
  avg_efficiency_km_per_kwh?: number;
  avg_cost_per_km_inr?: number;
  charger_utilization_pct?: number;
  near_strand_count?: number;
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
  avg_soc?: number;
  stranded_count?: number;
  critical_soc_count?: number;
  charging_count?: number;
  energy_cost_today_inr?: number;
  charger_utilization_pct?: number;
  avg_efficiency_km_per_kwh?: number;
  avg_cost_per_km_inr?: number;
  near_strand_count?: number;
}

/** The diff document at fleet:latest:diff (30s TTL). */
export interface FleetDiff {
  ts: number; // mutation timestamp — doubles as the ETag
  bins: BinDiff[];
}

/** Colour-encoding mode toggled from the legend (agents.md §1, §6). */
export type ViewMode = 'combined' | 'health' | 'density';
