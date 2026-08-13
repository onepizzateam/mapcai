import { Redis } from '@upstash/redis';
import type {
  BinSummary,
  FleetDiff,
  RegionSummary,
  TrendPoint,
  Vehicle,
  VehicleStatus,
} from './types';

// ---------------------------------------------------------------------------
// Upstash Redis client + typed helpers (agents.md §2, §3).
//
// Upstash, NOT Vercel KV: KV was sunset and migrated to Upstash in Dec 2024, so
// new projects provision Redis through the Upstash Marketplace integration.
//
// REST client, so every helper is a discrete HTTP round trip — which is why the
// read path is written as ONE pipeline per request, never a loop of awaits.
// ---------------------------------------------------------------------------

/** Every key in the data model. Centralised so the seeder, routes and writer
 *  can never drift on a key name. */
export const KEYS = {
  meta: 'fleet:meta',
  /** Bin id index. Not in §2's list, but required: enumerating bins with SCAN
   *  inside a request path is unbounded work. A Set makes it one O(1) read. */
  binsIndex: 'fleet:bins:index',
  regionsIndex: 'fleet:regions:index',
  bin: (id: string) => `fleet:bin:${id}`,
  binVehicles: (id: string) => `fleet:bin:${id}:vehicles`,
  vehicle: (id: string) => `fleet:vehicle:${id}`,
  regionSummary: (name: string) => `fleet:region:${name}:summary`,
  regionTrend: (name: string) => `fleet:region:${name}:trend`,
  alertsRecent: 'fleet:alerts:recent',
  writerLock: 'fleet:writer:lock',
  /** Diff document the SSE reader polls (agents.md §5). */
  latestDiff: 'fleet:latest:diff',
  /** Version tag for idempotent re-seeding. */
  seedVersion: 'fleet:seed:version',
} as const;

export const WRITER_LOCK_TTL_SEC = 6; // agents.md §5
export const DIFF_TTL_SEC = 30; // agents.md §5
export const TREND_WINDOW_HOURS = 24; // agents.md §2

let client: Redis | null = null;

/** True when the deployment has Upstash credentials. Routes use this to return
 *  an actionable 503 instead of throwing an opaque error. */
export function isRedisConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** Lazy singleton — one client per warm serverless instance. */
export function getRedis(): Redis {
  if (!client) {
    if (!isRedisConfigured()) {
      throw new Error(
        'Upstash Redis is not configured. Copy .env.local.example to .env.local and set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.'
      );
    }
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL as string,
      token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
    });
  }
  return client;
}

// --- coercion -------------------------------------------------------------
// Redis hash fields are strings on the wire; the SDK may hand back numbers or
// strings depending on how a value was written. Coerce at the boundary once so
// no consumer ever type-guards a hash field.

type Hash = Record<string, unknown> | null;

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function toBin(id: string, h: Hash): BinSummary | null {
  if (!h || Object.keys(h).length === 0) return null;
  return {
    id,
    lat: num(h.lat),
    lng: num(h.lng),
    vehicle_count: num(h.vehicle_count),
    avg_soc: num(h.avg_soc),
    avg_soh: num(h.avg_soh),
    avg_range_km: num(h.avg_range_km), stranded_count: num(h.stranded_count), critical_soc_count: num(h.critical_soc_count),
    charging_count: num(h.charging_count), driving_count: num(h.driving_count), parked_count: num(h.parked_count), avg_degradation_rate: num(h.avg_degradation_rate),
    energy_cost_today_inr: num(h.energy_cost_today_inr), charger_utilization_pct: num(h.charger_utilization_pct),
    open_exceptions: num(h.open_exceptions),
    alerts_per_1k: num(h.alerts_per_1k),
    region: str(h.region),
  };
}

function toVehicle(h: Hash): Vehicle | null {
  if (!h || Object.keys(h).length === 0) return null;
  return {
    id: str(h.id),
    model: str(h.model),
    soc: num(h.soc),
    status: str(h.status, 'parked') as VehicleStatus,
    soh: num(h.soh),
    plate: str(h.plate), degradation_rate: num(h.degradation_rate), range_km: num(h.range_km), rated_range_km: num(h.rated_range_km),
    energy_consumed_kwh: num(h.energy_consumed_kwh), energy_cost_inr: num(h.energy_cost_inr), last_charge_duration_min: num(h.last_charge_duration_min),
    charge_type: str(h.charge_type, 'none') as Vehicle['charge_type'], thermal_status: str(h.thermal_status, 'normal') as Vehicle['thermal_status'],
    trips_today: num(h.trips_today), km_today: num(h.km_today), uptime_pct: num(h.uptime_pct), bin_id: str(h.bin_id ?? h.bin),
    lat: num(h.lat),
    lng: num(h.lng),
  };
}

/**
 * Trend members are encoded `"{hour}:{avg_soh}"`.
 *
 * §2 describes the member as the bare avg_soh. Storing it that way silently
 * loses points: sorted-set members are unique, so two hours reporting the same
 * SOH collapse into one entry and the 24h ring quietly drops a sample. Prefixing
 * the hour keeps members unique while the SCORE stays the hour-epoch, so the
 * ZREMRANGEBYSCORE ring trim is unchanged. Bare values are still parsed, so
 * older data reads cleanly.
 */
export function encodeTrendMember(point: TrendPoint): string {
  return `${point.hour}:${point.avg_soc ?? point.avg_soh ?? 0}`;
}

function parseTrendMember(member: unknown, score: number): TrendPoint {
  const raw = str(member);
  const sep = raw.indexOf(':');
  if (sep > -1) {
    return { hour: num(raw.slice(0, sep), score), avg_soc: num(raw.slice(sep + 1)) };
  }
  return { hour: score, avg_soc: num(raw) };
}

// --- reads ----------------------------------------------------------------

export async function getMeta(): Promise<{ total_vehicles: number; last_updated: number }> {
  const h = (await getRedis().hgetall(KEYS.meta)) as Hash;
  return {
    total_vehicles: num(h?.total_vehicles),
    last_updated: num(h?.last_updated),
  };
}

/**
 * All bin summaries in ONE round trip — O(n_bins), not O(n_vehicles)
 * (agents.md §2, §10).
 *
 * §2 calls this a "pipelined MGET". Literal MGET only reads string keys, and §2
 * also specifies each bin as a Hash — so this is a pipeline of HGETALLs, which
 * is the same shape and the same single round trip. Naming the difference beats
 * silently restructuring the data model to satisfy the word "MGET".
 */
export async function getAllBins(): Promise<BinSummary[]> {
  const r = getRedis();
  const ids = ((await r.smembers(KEYS.binsIndex)) as string[]) ?? [];
  if (ids.length === 0) return [];

  ids.sort(); // stable order → stable hexbin keys across requests

  const pipeline = r.pipeline();
  for (const id of ids) pipeline.hgetall(KEYS.bin(id));
  const rows = (await pipeline.exec()) as Hash[];

  const bins: BinSummary[] = [];
  ids.forEach((id, i) => {
    const bin = toBin(id, rows[i]);
    if (bin) bins.push(bin);
  });
  return bins;
}

export async function getBin(id: string): Promise<BinSummary | null> {
  const h = (await getRedis().hgetall(KEYS.bin(id))) as Hash;
  return toBin(id, h);
}

/**
 * The bin's vehicle list — already SOC-ascending because the writer stores it
 * that way (agents.md §2). Two round trips: LRANGE for the ids, then one
 * pipeline for the hashes.
 */
export async function getBinVehicles(id: string): Promise<Vehicle[]> {
  const r = getRedis();
  const ids = ((await r.lrange(KEYS.binVehicles(id), 0, -1)) as string[]) ?? [];
  if (ids.length === 0) return [];

  const pipeline = r.pipeline();
  for (const vid of ids) pipeline.hgetall(KEYS.vehicle(vid));
  const rows = (await pipeline.exec()) as Hash[];

  const vehicles: Vehicle[] = [];
  for (const row of rows) {
    const v = toVehicle(row);
    if (v) vehicles.push(v);
  }
  // Preserve the stored triage order even if a hash went missing mid-flight.
  return vehicles.sort((a, b) => a.soc - b.soc);
}

export async function getRegionSummaries(): Promise<RegionSummary[]> {
  const r = getRedis();
  const names = ((await r.smembers(KEYS.regionsIndex)) as string[]) ?? [];
  if (names.length === 0) return [];

  const pipeline = r.pipeline();
  for (const name of names) pipeline.hgetall(KEYS.regionSummary(name));
  const rows = (await pipeline.exec()) as Hash[];

  const out: RegionSummary[] = [];
  names.forEach((name, i) => {
    const h = rows[i];
    if (!h || Object.keys(h).length === 0) return;
    out.push({
      name,
      vehicle_count: num(h.vehicle_count),
      alerts_per_1k: num(h.alerts_per_1k),
      share_pct: num(h.share_pct),
    });
  });
  // Largest fleet first — the sidebar reads as a triage order, not an alphabet.
  return out.sort((a, b) => b.vehicle_count - a.vehicle_count);
}

/** 24h avg-SOH trend for one region, oldest → newest. */
export async function getRegionTrend(name: string): Promise<TrendPoint[]> {
  const raw = (await getRedis().zrange(KEYS.regionTrend(name), 0, -1, {
    withScores: true,
  })) as unknown[];

  const points: TrendPoint[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    points.push(parseTrendMember(raw[i], num(raw[i + 1])));
  }
  return points.sort((a, b) => a.hour - b.hour);
}

// --- diff (writer writes, stream reads) -----------------------------------

export async function getLatestDiff(): Promise<FleetDiff | null> {
  const raw = await getRedis().get(KEYS.latestDiff);
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as FleetDiff; // SDK auto-parsed JSON
  try {
    return JSON.parse(String(raw)) as FleetDiff;
  } catch {
    return null;
  }
}

/** WRITE PATH — only /api/writer may call this (agents.md §5, hard rule 2). */
export async function setLatestDiff(diff: FleetDiff): Promise<void> {
  await getRedis().set(KEYS.latestDiff, JSON.stringify(diff), { ex: DIFF_TTL_SEC });
}

// --- distributed lock (writer only) ---------------------------------------

/** SET NX EX — one writer at a time, even if QStash retries (agents.md §5). */
export async function acquireWriterLock(token: string): Promise<boolean> {
  const res = await getRedis().set(KEYS.writerLock, token, {
    nx: true,
    ex: WRITER_LOCK_TTL_SEC,
  });
  return res === 'OK';
}

/** Release only if we still own it — never delete another writer's lock. */
export async function releaseWriterLock(token: string): Promise<void> {
  const r = getRedis();
  const current = await r.get(KEYS.writerLock);
  if (String(current) === token) await r.del(KEYS.writerLock);
}

// --- WRITE PATH -----------------------------------------------------------
// Everything below is called ONLY from /api/writer (agents.md §5, hard rule 2).
// /api/stream and the two read routes never import these. Keeping them in the
// same module as the readers is deliberate — the key names live in one place —
// but the boundary is the export list, and it is documented here so a future
// edit can't quietly add a write to the reader.

export interface BinMutation {
  id: string;
  region: string;
  vehicle_count: number;
  avg_soh: number;
  open_exceptions: number;
  avg_soc?: number; stranded_count?: number; critical_soc_count?: number; charging_count?: number;
  /** Vehicles whose SOC/status changed — rewritten and re-ordered SOC-ascending. */
  vehicles: Vehicle[];
}

/** Max alerts retained in fleet:alerts:recent. */
const ALERTS_CAP = 100;

/**
 * Persist one writer tick: bin hashes, changed vehicle hashes, re-sorted vehicle
 * lists, region summaries, trend points, alerts and meta — in ONE pipeline, so
 * a tick is a single REST round trip rather than N.
 */
export async function commitMutations(
  mutations: BinMutation[],
  regions: RegionSummary[],
  alerts: string[],
  ts: number
): Promise<void> {
  const r = getRedis();
  const pipeline = r.pipeline();
  const hour = Math.floor(ts / 3_600_000);
  const oldestHour = hour - TREND_WINDOW_HOURS;

  for (const m of mutations) {
    pipeline.hset(KEYS.bin(m.id), {
      vehicle_count: m.vehicle_count,
      avg_soh: m.avg_soh,
      open_exceptions: m.open_exceptions,
      ...(m.avg_soc === undefined ? {} : { avg_soc: m.avg_soc }),
      ...(m.stranded_count === undefined ? {} : { stranded_count: m.stranded_count }),
      ...(m.critical_soc_count === undefined ? {} : { critical_soc_count: m.critical_soc_count }),
      ...(m.charging_count === undefined ? {} : { charging_count: m.charging_count }),
    });

    for (const v of m.vehicles) {
      pipeline.hset(KEYS.vehicle(v.id), { soc: v.soc, status: v.status, soh: v.soh });
    }

    // Re-sorted triage order: SOC-ascending on write (agents.md §2).
    if (m.vehicles.length > 0) {
      const ordered = [...m.vehicles].sort((a, b) => a.soc - b.soc);
      const [firstId, ...restIds] = ordered.map((v) => v.id);
      pipeline.del(KEYS.binVehicles(m.id));
      pipeline.rpush(KEYS.binVehicles(m.id), firstId, ...restIds);
    }
  }

  for (const region of regions) {
    pipeline.hset(KEYS.regionSummary(region.name), {
      vehicle_count: region.vehicle_count,
      alerts_per_1k: region.alerts_per_1k,
      share_pct: region.share_pct,
    });
  }

  // Trend: one point per region per hour. Re-writing the same hour's member
  // overwrites it rather than accumulating, so the ring stays 24 entries wide.
  const touchedRegions = new Set(mutations.map((m) => m.region));
  for (const region of regions) {
    if (!touchedRegions.has(region.name)) continue;
    const avgSoh = averageSohForRegion(mutations, region.name);
    if (avgSoh == null) continue;
    pipeline.zremrangebyscore(KEYS.regionTrend(region.name), hour, hour);
    pipeline.zadd(KEYS.regionTrend(region.name), {
      score: hour,
      member: encodeTrendMember({ hour, avg_soh: avgSoh }),
    });
    pipeline.zremrangebyscore(KEYS.regionTrend(region.name), 0, oldestHour);
  }

  if (alerts.length > 0) {
    const entries = alerts.map((a, i) => ({ score: ts + i, member: a }));
    const [firstAlert, ...restAlerts] = entries;
    pipeline.zadd(KEYS.alertsRecent, firstAlert, ...restAlerts);
    // Keep the newest ALERTS_CAP — this is a recent-activity feed, not a log.
    pipeline.zremrangebyrank(KEYS.alertsRecent, 0, -(ALERTS_CAP + 1));
  }

  pipeline.hset(KEYS.meta, { last_updated: ts });

  await pipeline.exec();
}

/** Vehicle-count-weighted avg SOH across the mutated bins of one region. */
function averageSohForRegion(mutations: BinMutation[], region: string): number | null {
  let weight = 0;
  let sum = 0;
  for (const m of mutations) {
    if (m.region !== region) continue;
    weight += m.vehicle_count;
    sum += m.avg_soh * m.vehicle_count;
  }
  if (weight === 0) return null;
  return Math.round((sum / weight) * 10) / 10;
}


