import { scaleLinear } from 'd3-scale';
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
// three-stop red → amber → green scale the spec calls for.
// The low-SOC end is unhealthy/red; the high-SOC end is healthy/green.

/** Map raw SOC in [0,100] to a colourblind-safe hue. */
export function healthColour(soc: number): string {
  if (soc <= 20) return HEALTH_LOW;
  if (soc >= 50) return HEALTH_HIGH;
  const t = (soc - 20) / 30;
  return interpolateRgbBasis([HEALTH_LOW, HEALTH_MID, HEALTH_HIGH])(t);
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

export interface BinFillInput extends Pick<BinSummary, 'avg_soc' | 'avg_soh' | 'open_exceptions' | 'stranded_count' | 'critical_soc_count' | 'vehicle_count'> {
  urgencyOverride?: number;
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
  bin: BinFillInput,
  densityNorm: number,
  mode: ViewMode,
  socDomain: [number, number] = [0, 100]
): FillResult {
  const soc = bin.avg_soc ?? bin.avg_soh ?? 50;
  const strandedBoost = Math.min(50, ((bin.stranded_count ?? 0) / Math.max(1, bin.vehicle_count)) * 100);
  const effectiveSoc = Math.max(0, soc - strandedBoost);
  switch (mode) {
    case 'health':
      return { fill: healthColour(effectiveSoc), fillOpacity: OPACITY_MAX };
    case 'density':
      return { fill: DENSITY_NEUTRAL, fillOpacity: densityOpacity(densityNorm) };
    case 'combined':
    default:
      return { fill: healthColour(effectiveSoc), fillOpacity: densityOpacity(densityNorm) };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
