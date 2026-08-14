import { faker } from '@faker-js/faker';
import { readFileSync } from 'fs';
import { join } from 'path';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type {
  BinSummary,
  Vehicle,
  RegionSummary,
  TrendPoint,
  VehicleStatus,
} from '@/lib/types';

// Loaded lazily so this module remains usable in browser/runtime bundles. The
// land check is only exercised by the seed generators.
let _landPolygons: Array<{ type: string; coordinates: number[][][][] }> | null = null;

function getLandPolygons() {
  if (_landPolygons) return _landPolygons;
  const topo = JSON.parse(
    readFileSync(join(process.cwd(), 'node_modules/world-atlas/land-110m.json'), 'utf-8'),
  ) as Topology;
  const geojson = feature(topo, topo.objects.land as any) as any;
  _landPolygons = geojson.features
    ? geojson.features.map((f: any) => f.geometry)
    : [geojson.geometry];
  return _landPolygons!;
}

function pointInPolygon(lat: number, lng: number, coords: number[][][]): boolean {
  let inside = false;
  for (const ring of coords) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function isOnLand(lat: number, lng: number): boolean {
  for (const geom of getLandPolygons()) {
    const coords = geom.type === 'Polygon'
      ? geom.coordinates
      : geom.type === 'MultiPolygon'
        ? geom.coordinates.flat(1)
        : [];
    if (pointInPolygon(lat, lng, coords as number[][][])) return true;
  }
  return false;
}

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
export const BIN_COUNT = 500;

const MODELS_BY_REGION: Record<string, { name: string; rated_range: number }[]> = {
  india: [
    { name: 'Tata Nexon EV', rated_range: 465 }, { name: 'Tata Tiago EV', rated_range: 315 },
    { name: 'MG ZS EV', rated_range: 461 }, { name: 'MG Windsor EV', rated_range: 331 },
    { name: 'Ola S1 Pro', rated_range: 195 }, { name: 'Ather 450X', rated_range: 146 },
    { name: 'BYD Atto 3', rated_range: 521 }, { name: 'Hyundai Creta EV', rated_range: 473 },
  ],
  china: [
    { name: 'BYD Han EV', rated_range: 605 }, { name: 'BYD Seagull', rated_range: 405 },
    { name: 'Wuling Hongguang Mini EV', rated_range: 170 }, { name: 'NIO ET5', rated_range: 550 },
    { name: 'XPeng P7', rated_range: 670 }, { name: 'Li Auto L9', rated_range: 1080 },
    { name: 'AITO M7', rated_range: 1050 }, { name: 'Chery iCar 03', rated_range: 500 },
  ],
  usa: [
    { name: 'Tesla Model 3', rated_range: 576 }, { name: 'Tesla Model Y', rated_range: 531 },
    { name: 'Chevrolet Bolt EV', rated_range: 417 }, { name: 'Ford F-150 Lightning', rated_range: 515 },
    { name: 'Rivian R1T', rated_range: 505 },
  ],
  europe: [
    { name: 'Volkswagen ID.4', rated_range: 520 }, { name: 'Tesla Model 3', rated_range: 576 },
    { name: 'Renault Zoe', rated_range: 395 }, { name: 'Peugeot e-208', rated_range: 362 },
    { name: 'BMW iX3', rated_range: 460 }, { name: 'Hyundai Ioniq 5', rated_range: 507 },
  ],
  sea: [
    { name: 'BYD Atto 3', rated_range: 521 }, { name: 'BYD Dolphin', rated_range: 427 },
    { name: 'MG ZS EV', rated_range: 461 }, { name: 'Wuling Air EV', rated_range: 300 },
    { name: 'Neta V', rated_range: 401 },
  ],
  me: [
    { name: 'Tesla Model 3', rated_range: 576 }, { name: 'Tesla Model Y', rated_range: 531 },
    { name: 'BYD Atto 3', rated_range: 521 }, { name: 'Hyundai Ioniq 6', rated_range: 614 },
  ],
  world: [
    { name: 'Tesla Model 3', rated_range: 576 }, { name: 'BYD Atto 3', rated_range: 521 },
    { name: 'Nissan Leaf', rated_range: 364 }, { name: 'Hyundai Kona Electric', rated_range: 484 },
  ],
};
const ENERGY_COST_INR = 8.5;

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
  if (r < 0.60) return 'driving';
  if (r < 0.82) return 'charging';
  if (r < 0.95) return 'parked';
  return 'stranded';
}

function plateFor(regionHint: string): string {
  const alpha = (length: number) => faker.string.alpha({ length, casing: 'upper' });
  const digits = (length: number) => String(faker.number.int({ min: 0, max: 10 ** length - 1 })).padStart(length, '0');
  switch (regionHint) {
    case 'china': return `${faker.helpers.arrayElement(['京', '沪', '粤', '苏', '浙', '川'])}${alpha(1)}·${faker.string.alphanumeric({ length: 5, casing: 'upper' })}`;
    case 'usa': return `${alpha(3)}-${faker.number.int({ min: 1000, max: 9999 })}`;
    case 'europe': return `${alpha(2)}-${alpha(3)}-${digits(2)}`;
    case 'sea': return `${alpha(1)} ${digits(4)} ${alpha(2)}`;
    case 'me': return `${alpha(1)}·${faker.string.alphanumeric({ length: 5, casing: 'upper' })}`;
    default: return `EV-${String(faker.number.int({ min: 1, max: 99 })).padStart(2, '0')}-${alpha(2)}-${String(faker.number.int({ min: 1, max: 9999 })).padStart(4, '0')}`;
  }
}

// --- generators -----------------------------------------------------------

/**
 * Scatter BIN_COUNT bins across the hotspots (count proportional to weight),
 * with a small gaussian jitter around each metro so the hexbin looks organic.
 * Deterministic given the seed.
 */
export function generateBins(): ({ bin: BinSummary; regionHint: string } & BinSummary)[] {
  const regions = [
    ['india', 0.55, { latMin: 8, latMax: 35.5, lngMin: 68, lngMax: 97.5 }],
    ['china', 0.80, { latMin: 18, latMax: 53, lngMin: 73, lngMax: 135 }],
    ['usa', 0.85, { latMin: 25, latMax: 49, lngMin: -125, lngMax: -67 }],
    ['europe', 0.90, { latMin: 36, latMax: 71, lngMin: -10, lngMax: 40 }],
    ['sea', 0.95, { latMin: -10, latMax: 20, lngMin: 95, lngMax: 140 }],
    ['me', 0.98, { latMin: 12, latMax: 38, lngMin: 35, lngMax: 60 }],
    ['world', 1, { latMin: -55, latMax: 70, lngMin: -180, lngMax: 180 }],
  ] as const;
  const bins: ({ bin: BinSummary; regionHint: string } & BinSummary)[] = [];
  for (let i = 0; i < BIN_COUNT; i++) {
      const roll = faker.number.float({ min: 0, max: 1 });
      const [regionHint, , bbox] = regions.find(([, threshold]) => roll < threshold)!;
      let lat: number;
      let lng: number;
      let attempts = 0;
      do {
        lat = faker.number.float({ min: bbox.latMin, max: bbox.latMax });
        lng = faker.number.float({ min: bbox.lngMin, max: bbox.lngMax });
        attempts++;
      } while (!isOnLand(lat, lng) && attempts < 50);

      // Delhi is a safe deterministic fallback if repeated sampling misses
      // land (for example, near a narrow coastal/island region).
      if (!isOnLand(lat, lng)) {
        lat = 28.6139;
        lng = 77.2090;
      }
      const bin = {
        id: `bin_${String(i).padStart(3, '0')}`,
        lat: round(lat, 4),
        lng: round(lng, 4),
        vehicle_count: 0,
        avg_soc: 0,
        avg_soh: 0,
        avg_range_km: 0, stranded_count: 0, critical_soc_count: 0,
        charging_count: 0, driving_count: 0, parked_count: 0,
        avg_degradation_rate: 0, energy_cost_today_inr: 0,
        charger_utilization_pct: 0,
        open_exceptions: 0,
        alerts_per_1k: 0,
        region: '',
      };
      // Keep the legacy coordinate fields available to the seed CLI while the
      // generator itself also carries the non-persisted region hint.
      bins.push({ ...bin, bin, regionHint });
  }
  return bins;
}

export interface GeneratedFleet {
  bins: BinSummary[];
  vehicles: Vehicle[];
  vehiclesByBin: Map<string, Vehicle[]>; // SOC-ascending
  regions: RegionSummary[];
  trends: Map<string, TrendPoint[]>;
}

/**
 * Full deterministic fleet: assigns 25k vehicles to bins (weighted by the
 * metro), rolls up bin + region summaries, and backfills 24h trends.
 */
export function generateFleet(): GeneratedFleet {
  reseed();
  const generatedBins = generateBins();
  const bins = generatedBins.map(({ bin }) => bin);
  const minimumFleet = 50;
  const targetMean = TOTAL_VEHICLES / BIN_COUNT;
  const counts = bins.map(() => {
    const raw = sampleBeta(1.5, 4);
    const scaled = Math.round((raw / 0.273) * targetMean * 0.7);
    return Math.min(1500, Math.max(1, scaled));
  });
  let correction = TOTAL_VEHICLES - counts.reduce((s, n) => s + n, 0);
  for (let i = 0; correction !== 0 && i < counts.length * 2000; i++) {
    const index = i % counts.length;
    const delta = correction > 0 ? 1 : -1;
    if (counts[index] + delta >= minimumFleet && counts[index] + delta <= 1500) {
      counts[index] += delta;
      correction -= delta;
    }
  }

  const vehicles: Vehicle[] = [];
  const vehiclesByBin = new Map<string, Vehicle[]>();
  let vid = 0;

  bins.forEach((bin, bi) => {
    const regionHint = generatedBins[bi].regionHint;
    const n = counts[bi];
    const list: Vehicle[] = [];
    let sohSum = 0, socSum = 0, rangeSum = 0, degradationSum = 0, energyCost = 0;
    let stranded = 0, critical = 0, charging = 0, driving = 0, parked = 0;

    for (let i = 0; i < n; i++) {
      const soh = sampleSOH();
      const model = faker.helpers.arrayElement(MODELS_BY_REGION[regionHint]);
      // Every tenth bin is an intentionally severe triage cluster so the
      // urgency scale visibly exercises its red end in the seeded demo.
      const effectiveStatus = bi % 10 === 0 ? 'stranded' : sampleStatus();
      const soc = effectiveStatus === 'stranded' ? faker.number.float({ min: 2, max: 7.9 }) : faker.number.float({ min: 5, max: 100 });
      const degradation = round(clamp(1.8 + gaussian() * 0.8, 0.3, 6), 1);
      const range = round((soc / 100) * model.rated_range * (soh / 100), 1);
      const energy = round(faker.number.float({ min: 2, max: 42 }), 1);
      sohSum += soh;
      const v: Vehicle = {
        id: `veh_${String(vid).padStart(6, '0')}`,
        plate: plateFor(regionHint), model: model.name, soc, status: effectiveStatus,
        soh,
        degradation_rate: degradation, range_km: range, rated_range_km: model.rated_range,
        energy_consumed_kwh: energy, energy_cost_inr: round(energy * ENERGY_COST_INR, 0),
        last_charge_duration_min: effectiveStatus === 'charging' ? faker.number.int({ min: 10, max: 180 }) : 0,
        charge_type: effectiveStatus === 'charging' ? faker.helpers.arrayElement(['AC_slow', 'DC_fast'] as const) : 'none',
        thermal_status: faker.helpers.weightedArrayElement([{ value: 'normal' as const, weight: 90 }, { value: 'elevated' as const, weight: 8 }, { value: 'critical' as const, weight: 2 }]),
        trips_today: faker.number.int({ min: 0, max: 8 }), km_today: faker.number.int({ min: 0, max: 220 }), uptime_pct: round(faker.number.float({ min: 88, max: 99.9 }), 1),
        bin_id: bin.id,
        lat: round(bin.lat + gaussian() * 0.02, 5),
        lng: round(bin.lng + gaussian() * 0.02, 5),
      };
      vehicles.push(v);
      list.push(v);
      vid++; socSum += soc; rangeSum += range; degradationSum += degradation; energyCost += v.energy_cost_inr ?? 0;
      if (soc < 8 && effectiveStatus !== 'charging') stranded++; if (soc < 20) critical++;
      if (effectiveStatus === 'charging') charging++; else if (effectiveStatus === 'driving') driving++; else if (effectiveStatus === 'parked') parked++;
    }

    // Exceptions ~ Poisson(λ=8 per 1,000 vehicles).
    const exceptions = samplePoisson((n / 1000) * 8);

    bin.vehicle_count = n;
    bin.avg_soc = round(socSum / n, 1);
    bin.avg_soh = round(sohSum / n, 1);
    bin.avg_range_km = round(rangeSum / n, 1); bin.stranded_count = stranded; bin.critical_soc_count = critical;
    bin.charging_count = charging; bin.driving_count = driving; bin.parked_count = parked;
    bin.avg_degradation_rate = round(degradationSum / n, 1); bin.energy_cost_today_inr = energyCost;
    bin.charger_utilization_pct = round((charging / Math.max(1, Math.round(n * 0.3))) * 100, 1);
    bin.open_exceptions = exceptions;
    bin.alerts_per_1k = round((exceptions / n) * 1000, 1);

    // Per-bin list: SOC-ascending (most critical first).
    list.sort((a, b) => a.soc - b.soc);
    vehiclesByBin.set(bin.id, list);
  });

  const regions = rollupRegions(bins);
  const trends = backfillTrends(regions);

  return { bins, vehicles, vehiclesByBin, regions, trends };
}

/** Region rollups: totals, alerts-per-1k, and share of fleet. */
export function rollupRegions(bins: BinSummary[]): RegionSummary[] {
  const byRegion = new Map<string, { count: number; exc: number; stranded: number; charging: number; energy: number }>();
  for (const b of bins) {
    const cur = byRegion.get(b.region) ?? { count: 0, exc: 0, stranded: 0, charging: 0, energy: 0 };
    cur.count += b.vehicle_count;
    cur.exc += b.open_exceptions;
    cur.stranded += b.stranded_count ?? 0; cur.charging += b.charging_count ?? 0; cur.energy += b.energy_cost_today_inr ?? 0;
    byRegion.set(b.region, cur);
  }
  const total = bins.reduce((s, b) => s + b.vehicle_count, 0) || 1;
  return Array.from(byRegion.entries()).map(([name, { count, exc, stranded, charging, energy }]) => ({
    name,
    vehicle_count: count,
    alerts_per_1k: round(count > 0 ? (exc / count) * 1000 : 0, 1),
    share_pct: round((count / total) * 100, 1),
    stranded_count: stranded, charging_count: charging, energy_cost_today_inr: energy,
  }));
}

/**
 * 24 synthetic hourly SOH points per region so the sparkline is populated on
 * first load. A gentle random walk around the region's current avg SOH.
 */
export function backfillTrends(regions: RegionSummary[]): Map<string, TrendPoint[]> {
  const nowHour = Math.floor(Date.now() / 3_600_000);
  const map = new Map<string, TrendPoint[]>();
  for (const r of regions) {
    // Anchor near a plausible fleet SOH; walk backwards 24h.
    let soc = 45 + gaussian() * 8;
    const points: TrendPoint[] = [];
    for (let h = 23; h >= 0; h--) {
      soc = clamp(soc + gaussian() * 3, 8, 95);
      points.push({ hour: nowHour - h, avg_soc: round(soc, 1) });
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
