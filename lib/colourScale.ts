import { scaleLinear, scaleSequential } from 'd3-scale';
import { interpolateRgbBasis } from 'd3-interpolate';
import type { BinSummary, ViewMode } from './types';

// ---------------------------------------------------------------------------
// Dual-channel colour encoding — the core visual improvement (agents.md §1).
//
//   Fill HUE      → fleet health index  (avg_SOH × (1 − exception_rate))
//   Fill OPACITY  → vehicle count (density)
//
// Palette is colourblind-safe red → amber → blue (agents.md §7), NOT the
// reference's purple-only scale. Single-hue scales lose perceptual resolution
// across the range; a diverging red→amber→blue maximises discriminability.
// ---------------------------------------------------------------------------

export const HEALTH_LOW = '#EF4444'; // urgent / stranded
export const HEALTH_MID = '#F59E0B'; // marginal
export const HEALTH_HIGH = '#22C55E'; // healthy

/** Neutral fill used by "Density only" mode where hue carries no meaning. */
export const DENSITY_NEUTRAL = '#5B5BD6'; // --color-accent

// Density opacity bounds. A faint floor keeps sparse bins visible; the ceiling
// stays below 1 so overlapping hexes at borders remain legible.
export const OPACITY_MIN = 0.15;
export const OPACITY_MAX = 0.92;

/**
 * Fleet health index in [0,1]. Higher = healthier.
 * exceptionRate is exceptions-per-vehicle, clamped so a pathological bin can't
 * drive the index negative.
 */
export function healthIndex(bin: Pick<BinSummary, 'avg_soh' | 'open_exceptions' | 'vehicle_count'>): number {
  const sohNorm = clamp01(bin.avg_soh / 100);
  const exceptionRate = bin.open_exceptions / 1000;
  const index = sohNorm * (1 - clamp01(exceptionRate));
  return clamp01(index);
}

// Diverging hue ramp. d3 interpolates through the amber midpoint, giving the
// three-stop red → amber → blue scale the spec calls for.
const hueScale = scaleSequential(interpolateRgbBasis([HEALTH_HIGH, HEALTH_MID, HEALTH_LOW])).domain([0, 1]);

/** Map a health index in [0,1] to a colourblind-safe hue. */
export function healthColour(index: number): string {
  return hueScale(clamp01(index));
}

/**
 * Density → opacity. densityNorm is expected pre-normalised to [0,1]
 * (typically count / maxCount across the visible bins).
 */
const opacityScale = scaleLinear()
  .domain([0, 1])
  .range([OPACITY_MIN, OPACITY_MAX])
  .clamp(true);

export function densityOpacity(densityNorm: number): number {
  return opacityScale(clamp01(densityNorm));
}

export interface FillResult {
  fill: string;
  fillOpacity: number;
}

/**
 * Single entry point the D3 layer calls per hex. Branches on view mode — three
 * fill-function branches behind one Zustand flag (agents.md §6):
 *
 *   combined → hue = health, opacity = density   (the default dual encoding)
 *   health   → hue = health, opacity = flat      (isolate health)
 *   density  → hue = neutral, opacity = density   (isolate density)
 */
export function binFill(
  bin: Pick<BinSummary, 'avg_soc' | 'avg_soh' | 'open_exceptions' | 'stranded_count' | 'critical_soc_count' | 'vehicle_count'>,
  densityNorm: number,
  mode: ViewMode
): FillResult {
  const count = Math.max(1, bin.vehicle_count);
  const urgency = clamp01(((bin.stranded_count ?? 0) / count) * 0.6 + ((bin.critical_soc_count ?? 0) / count) * 0.4);
  switch (mode) {
    case 'health':
      return { fill: healthColour(urgency), fillOpacity: OPACITY_MAX };
    case 'density':
      return { fill: DENSITY_NEUTRAL, fillOpacity: densityOpacity(densityNorm) };
    case 'combined':
    default:
      return { fill: healthColour(urgency), fillOpacity: densityOpacity(densityNorm) };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
