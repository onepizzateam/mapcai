import { faker } from '@faker-js/faker';
import { HOTSPOTS, INDIA_BOUNDS } from '@/lib/regions';
import type {
  BinSummary,
  Vehicle,
  RegionSummary,
  RegionName,
  TrendPoint,
  VehicleStatus,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Deterministic fleet data generation (agents.md §2). faker.seed(42) makes the
// output reproducible across reviewers. This module holds the pure generators;
// scripts/seed.ts orchestrates writing them to Upstash Redis.
//
//   • 25,000 vehicles across ~90 hex bins clustered on real EV hotspots
//   • SOH: beta distribution — most 85–98%, long tail below 70%
//   • SOC: uniform [5,100]; Status: 65% Driving / 25% Charging / 10% Parked
//   • Open exceptions: Poisson(λ=8) per 1,000 vehicles
//   • 24h hourly trend backfill per region
// ---------------------------------------------------------------------------

export const SEED = 42;
export const TOTAL_VEHICLES = 25_000;
export const BIN_COUNT = 90;
export const VEHICLE_LIST_CAP = 50; // per-bin list trimmed to 50 (agents.md §2)

const EV_MODELS = [
  'Tata Nexon EV',
  'Tata Tigor EV',
  'MG ZS EV',
  'Mahindra XUV400',
  'Hyundai Kona',
  'Ola S1 Pro',
  'Ather 450X',
  'BYD Atto 3',
  'Citroen eC3',
];

/** Reset faker to the fixed seed. Call once before any generation. */
export function reseed(): void {
  faker.seed(SEED);
}

// --- distribution samplers ------------------------------------------------

/** Gamma sampler (Marsaglia–Tsang) using faker's seeded RNG for determinism. */
function sampleGamma(k: number): number {
  if (k < 1) {
    const u = faker.number.float({ min: 1e-9, max: 1 });
    return sampleGamma(1 + k) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x = 0;
    let v = 0;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = faker.number.float({ min: 1e-9, max: 1 });
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Standard normal via Box–Muller on faker's seeded uniform. */
function gaussian(): number {
  const u1 = faker.number.float({ min: 1e-9, max: 1 });
  const u2 = faker.number.float({ min: 0, max: 1 });
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Beta(α,β) = Gamma(α)/(Gamma(α)+Gamma(β)). */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

/** Knuth Poisson sampler on faker's seeded uniform. */
function samplePoisson(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= faker.number.float({ min: 0, max: 1 });
  } while (p > L);
  return k - 1;
}

/**
 * SOH sample in [0,100]. Beta(9,1.4) skews high (mean ~87%), scaled into a
 * 55–100 window so the long tail lands below 70% as the spec describes.
 */
function sampleSOH(): number {
  const b = sampleBeta(9, 1.4);
  const soh = 55 + b * 45;
  return Math.round(Math.min(100, Math.max(50, soh)) * 10) / 10;
}

function sampleStatus(): VehicleStatus {
  const r = faker.number.float({ min: 0, max: 1 });
  if (r < 0.65) return 'driving';
  if (r < 0.9) return 'charging';
  return 'parked';
}

// --- generators -----------------------------------------------------------

/**
 * Scatter BIN_COUNT bins across the hotspots (count proportional to weight),
 * with a small gaussian jitter around each metro so the hexbin looks organic.
 * Deterministic given the seed.
 */
export function generateBins(): BinSummary[] {
  const totalWeight = HOTSPOTS.reduce((s, h) => s + h.weight, 0);
  const bins: BinSummary[] = [];
  let idx = 0;

  for (const hs of HOTSPOTS) {
    const share = hs.weight / totalWeight;
    const nBins = Math.max(4, Math.round(BIN_COUNT * share));
    for (let i = 0; i < nBins; i++) {
      const lat = clamp(
        hs.lat + gaussian() * 0.35,
        INDIA_BOUNDS.minLat,
        INDIA_BOUNDS.maxLat
      );
      const lng = clamp(
        hs.lng + gaussian() * 0.35,
        INDIA_BOUNDS.minLng,
        INDIA_BOUNDS.maxLng
      );
      bins.push({
        id: `bin_${String(idx).padStart(3, '0')}`,
        lat: round(lat, 4),
        lng: round(lng, 4),
        vehicle_count: 0, // filled once vehicles are assigned
        avg_soh: 0,
        open_exceptions: 0,
        region: hs.region,
      });
      idx++;
    }
  }
  return bins;
}

export interface GeneratedFleet {
  bins: BinSummary[];
  vehicles: Vehicle[];
  vehiclesByBin: Map<string, Vehicle[]>; // SOC-ascending, capped
  regions: RegionSummary[];
  trends: Map<RegionName, TrendPoint[]>;
}

/**
 * Full deterministic fleet: assigns 25k vehicles to bins (weighted by the
 * metro), rolls up bin + region summaries, and backfills 24h trends.
 */
export function generateFleet(): GeneratedFleet {
  reseed();
  const bins = generateBins();
  const binWeights = bins.map(() => faker.number.float({ min: 0.4, max: 1 }));
  const wSum = binWeights.reduce((s, w) => s + w, 0);

  // Distribute the fleet across bins proportional to each bin's weight.
  const counts = binWeights.map((w) => Math.max(1, Math.round((w / wSum) * TOTAL_VEHICLES)));

  const vehicles: Vehicle[] = [];
  const vehiclesByBin = new Map<string, Vehicle[]>();
  let vid = 0;

  bins.forEach((bin, bi) => {
    const n = counts[bi];
    const list: Vehicle[] = [];
    let sohSum = 0;

    for (let i = 0; i < n; i++) {
      const soc = round(faker.number.float({ min: 5, max: 100 }), 1);
      const soh = sampleSOH();
      sohSum += soh;
      const v: Vehicle = {
        id: `veh_${String(vid).padStart(6, '0')}`,
        model: faker.helpers.arrayElement(EV_MODELS),
        soc,
        status: sampleStatus(),
        soh,
        bin: bin.id,
        lat: round(bin.lat + gaussian() * 0.02, 5),
        lng: round(bin.lng + gaussian() * 0.02, 5),
      };
      vehicles.push(v);
      list.push(v);
      vid++;
    }

    // Exceptions ~ Poisson(λ=8 per 1,000 vehicles).
    const exceptions = samplePoisson((n / 1000) * 8);

    bin.vehicle_count = n;
    bin.avg_soh = round(sohSum / n, 1);
    bin.open_exceptions = exceptions;

    // Per-bin list: SOC-ascending (most critical first), capped at 50.
    list.sort((a, b) => a.soc - b.soc);
    vehiclesByBin.set(bin.id, list.slice(0, VEHICLE_LIST_CAP));
  });

  const regions = rollupRegions(bins);
  const trends = backfillTrends(regions);

  return { bins, vehicles, vehiclesByBin, regions, trends };
}

/** Region rollups: totals, alerts-per-1k, and share of fleet. */
export function rollupRegions(bins: BinSummary[]): RegionSummary[] {
  const byRegion = new Map<RegionName, { count: number; exc: number }>();
  for (const b of bins) {
    const cur = byRegion.get(b.region) ?? { count: 0, exc: 0 };
    cur.count += b.vehicle_count;
    cur.exc += b.open_exceptions;
    byRegion.set(b.region, cur);
  }
  const total = bins.reduce((s, b) => s + b.vehicle_count, 0) || 1;
  return Array.from(byRegion.entries()).map(([name, { count, exc }]) => ({
    name,
    vehicle_count: count,
    alerts_per_1k: round(count > 0 ? (exc / count) * 1000 : 0, 1),
    share_pct: round((count / total) * 100, 1),
  }));
}

/**
 * 24 synthetic hourly SOH points per region so the sparkline is populated on
 * first load. A gentle random walk around the region's current avg SOH.
 */
export function backfillTrends(regions: RegionSummary[]): Map<RegionName, TrendPoint[]> {
  const nowHour = Math.floor(Date.now() / 3_600_000);
  const map = new Map<RegionName, TrendPoint[]>();
  for (const r of regions) {
    // Anchor near a plausible fleet SOH; walk backwards 24h.
    let soh = 88 + gaussian() * 2;
    const points: TrendPoint[] = [];
    for (let h = 23; h >= 0; h--) {
      soh = clamp(soh + gaussian() * 0.4, 70, 99);
      points.push({ hour: nowHour - h, avg_soh: round(soh, 1) });
    }
    map.set(r.name, points);
  }
  return map;
}

// --- utils ----------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
