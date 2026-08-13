import { hexbin as d3Hexbin } from 'd3-hexbin';
import type { GeoProjection } from 'd3-geo';
import type { BinSummary } from './types';

// ---------------------------------------------------------------------------
// Discrete zoom-tier re-binning (agents.md §1 hard-rule 3, §4).
//
// Re-binning up to 25k points on every zoom frame is real jank. Instead we
// define a small set of tiers; the hexbin radius changes ONLY when crossing a
// breakpoint. Pan/zoom *within* a tier is a pure SVG transform on the map layer
// group — zero JS recompute per frame.
// ---------------------------------------------------------------------------

export interface ZoomTier {
  /** Upper bound (inclusive) of the d3-zoom scale factor for this tier. */
  maxZoom: number;
  /** Hexbin radius in px at this tier. */
  radius: number;
  /** Bins with vehicle_count below this hide their count label. */
  labelThreshold: number;
}

export const ZOOM_BREAKPOINTS: readonly ZoomTier[] = [
  { maxZoom: 1.5, radius: 22, labelThreshold: Infinity },
  { maxZoom: 3.5, radius: 13, labelThreshold: 500 },
  { maxZoom: Infinity, radius: 7, labelThreshold: 100 },
] as const;

/** Select the active tier for a given d3-zoom scale factor. */
export function tierForZoom(zoom: number): ZoomTier {
  for (const tier of ZOOM_BREAKPOINTS) {
    if (zoom <= tier.maxZoom) return tier;
  }
  // Unreachable (last tier is Infinity) but keeps the return type non-null.
  return ZOOM_BREAKPOINTS[ZOOM_BREAKPOINTS.length - 1];
}

/**
 * Return true when a zoom change crosses a tier boundary — the only time we
 * re-bin. Callers debounce the actual re-bin ~120ms (agents.md §4).
 */
export function crossesTier(prevZoom: number, nextZoom: number): boolean {
  return tierForZoom(prevZoom) !== tierForZoom(nextZoom);
}

/** A binned hex: aggregate of the vehicles/bins whose centroid falls inside. */
export interface HexDatum {
  x: number; // pixel centroid
  y: number;
  bins: BinSummary[]; // source bins in this hex
  vehicle_count: number; // summed
  open_exceptions: number; // summed
  avg_soh: number; // vehicle-count-weighted mean
  avg_soc: number;
  avg_range_km: number;
  stranded_count: number;
  critical_soc_count: number;
}

/**
 * Bin the projected bin-summaries into hexagons at the given radius.
 *
 * NOTE: our data is pre-aggregated bin summaries (~90 of them), not 25k raw
 * points, so this is cheap. The tiering machinery still matters because at
 * city tier the small radius produces near-1:1 hex:bin and we want the label
 * thresholds + weighted aggregation to be correct regardless.
 */
export function binHexes(
  data: BinSummary[],
  projection: GeoProjection,
  radius: number,
  width = Infinity,
  height = Infinity
): HexDatum[] {
  const validPoints = data.filter((d) => projection([d.lng, d.lat]) !== null);
  const hb = d3Hexbin<BinSummary>()
    .x((d) => projection([d.lng, d.lat])![0])
    .y((d) => projection([d.lng, d.lat])![1])
    .radius(radius)
    .extent([[-width, -height], [width * 2, height * 2]]);

  return hb(validPoints).map((cell) => {
    const source = cell as unknown as BinSummary[]; // d3 hexbin cell is an array of data + x/y
    const vehicle_count = source.reduce((s, b) => s + b.vehicle_count, 0);
    const open_exceptions = source.reduce((s, b) => s + b.open_exceptions, 0);
    // Weight SOH by vehicle_count so big bins dominate the hex health, not a
    // naive average that lets a tiny bin swing the colour.
    const weightedSoh =
      vehicle_count > 0
        ? source.reduce((s, b) => s + b.avg_soh * b.vehicle_count, 0) / vehicle_count
        : 0;

    const avg_soc = vehicle_count > 0 ? source.reduce((s, b) => s + (b.avg_soc ?? b.avg_soh ?? 0) * b.vehicle_count, 0) / vehicle_count : 0;
    const avg_range_km = vehicle_count > 0 ? source.reduce((s, b) => s + (b.avg_range_km ?? 0) * b.vehicle_count, 0) / vehicle_count : 0;
    return {
      x: cell.x,
      y: cell.y,
      bins: [...source],
      vehicle_count,
      open_exceptions,
      avg_soh: weightedSoh,
      avg_soc, avg_range_km,
      stranded_count: source.reduce((s, b) => s + (b.stranded_count ?? 0), 0),
      critical_soc_count: source.reduce((s, b) => s + (b.critical_soc_count ?? 0), 0),
    };
  });
}

/** SVG hexagon path for a given radius (shared by all hexes at a tier). */
export function hexPath(radius: number): string {
  return d3Hexbin().radius(radius).hexagon();
}

/** Max vehicle_count across hexes — the density-opacity normaliser. */
export function maxDensity(hexes: HexDatum[]): number {
  return hexes.reduce((m, h) => Math.max(m, h.vehicle_count), 0) || 1;
}
