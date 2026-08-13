import { describe, expect, it } from 'vitest';
import {
  DENSITY_NEUTRAL,
  HEALTH_HIGH,
  HEALTH_LOW,
  HEALTH_MID,
  OPACITY_MAX,
  OPACITY_MIN,
  binFill,
  densityOpacity,
  healthColour,
  healthIndex,
} from '@/lib/colourScale';

// Colour-scale math (agents.md §11 test checklist).
//
// This is the core visual claim of the project — dual-channel encoding, on a
// colourblind-safe palette — so it gets asserted rather than eyeballed. Reading
// a hex value off a screenshot proves nothing; these tests pin the contract.

/** d3 interpolates in RGB space, so hex tokens are compared as rgb() strings. */
function toRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function channels(rgb: string): [number, number, number] {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return [r, g, b];
}

const bin = (avg_soh: number, open_exceptions: number, vehicle_count: number) => ({
  avg_soh,
  open_exceptions,
  vehicle_count,
});

describe('healthIndex', () => {
  it('is avg_SOH × (1 − exception_rate)', () => {
    // 90% SOH, 10 exceptions across 100 vehicles → 0.9 × (1 − 0.1) = 0.81
    expect(healthIndex(bin(90, 10, 100))).toBeCloseTo(0.81, 5);
  });

  it('reduces to plain SOH when there are no exceptions', () => {
    expect(healthIndex(bin(90, 0, 100))).toBeCloseTo(0.9, 5);
  });

  it('separates a dense unhealthy bin from a dense healthy one', () => {
    // The whole point of the encoding: identical vehicle counts must not produce
    // identical colours when health differs (agents.md §0).
    expect(healthIndex(bin(60, 40, 2000))).toBeLessThan(healthIndex(bin(97, 2, 2000)));
  });

  it('clamps pathological input instead of going negative or NaN', () => {
    // More exceptions than vehicles is a data error, not a reason to crash the map.
    expect(healthIndex(bin(90, 500, 100))).toBe(0);
    expect(healthIndex(bin(90, 0, 0))).toBeCloseTo(0.9, 5);
  });
});

describe('healthColour', () => {
  it('maps the three-stop scale to its exact tokens', () => {
    expect(healthColour(0)).toBe(toRgb(HEALTH_LOW));
    expect(healthColour(0.5)).toBe(toRgb(HEALTH_MID));
    expect(healthColour(1)).toBe(toRgb(HEALTH_HIGH));
  });

  it('runs red → amber → blue, not a single hue', () => {
    // Guards the palette decision in agents.md §7: a single-hue (purple) ramp
    // loses perceptual resolution, so red must dominate the unhealthy end and
    // blue the healthy end.
    const [lowR, , lowB] = channels(healthColour(0));
    const [highR, , highB] = channels(healthColour(1));
    expect(lowR).toBeGreaterThan(lowB);
    expect(highB).toBeGreaterThan(highR);
  });

  it('clamps out-of-range indices to the scale ends', () => {
    expect(healthColour(-1)).toBe(toRgb(HEALTH_LOW));
    expect(healthColour(2)).toBe(toRgb(HEALTH_HIGH));
  });
});

describe('densityOpacity', () => {
  it('spans the configured bounds', () => {
    expect(densityOpacity(0)).toBeCloseTo(OPACITY_MIN, 5);
    expect(densityOpacity(1)).toBeCloseTo(OPACITY_MAX, 5);
  });

  it('keeps sparse bins visible and dense bins translucent', () => {
    // A floor above 0 means an empty-ish hex still reads as present; a ceiling
    // below 1 keeps overlapping hexes legible at region borders.
    expect(densityOpacity(0)).toBeGreaterThan(0);
    expect(densityOpacity(1)).toBeLessThan(1);
  });

  it('is monotonic in density', () => {
    expect(densityOpacity(0.25)).toBeLessThan(densityOpacity(0.75));
  });
});

describe('binFill view modes', () => {
  const unhealthyDense = bin(60, 40, 2000);

  it('combined encodes health in hue and density in opacity', () => {
    const fill = binFill(unhealthyDense, 1, 'combined');
    expect(fill.fill).toBe(healthColour(healthIndex(unhealthyDense)));
    expect(fill.fillOpacity).toBeCloseTo(OPACITY_MAX, 5);
  });

  it('health only holds opacity flat so hue carries all the signal', () => {
    const dense = binFill(unhealthyDense, 1, 'health');
    const sparse = binFill(unhealthyDense, 0, 'health');
    expect(dense.fillOpacity).toBe(sparse.fillOpacity);
    expect(dense.fill).toBe(healthColour(healthIndex(unhealthyDense)));
  });

  it('density only drops hue to neutral so opacity carries all the signal', () => {
    const fill = binFill(unhealthyDense, 0.5, 'density');
    expect(fill.fill).toBe(DENSITY_NEUTRAL);
    expect(fill.fillOpacity).toBeCloseTo(densityOpacity(0.5), 5);
  });

  it('gives density-identical bins different hues when health differs', () => {
    // Restates the §0 gap at the level the D3 layer actually calls.
    const sick = binFill(bin(60, 40, 2000), 1, 'combined');
    const well = binFill(bin(97, 2, 2000), 1, 'combined');
    expect(sick.fillOpacity).toBeCloseTo(well.fillOpacity, 5);
    expect(sick.fill).not.toBe(well.fill);
  });
});
