import { generateFleet } from './faker/seed';
import {
  KEYS,
  encodeTrendMember,
  getRedis,
  TREND_WINDOW_HOURS,
} from './redis';

// ---------------------------------------------------------------------------
// Shared seed routine (agents.md §2). Lives in lib/ so scripts/seed.ts (CLI) and
// /api/seed (non-prod route) run the SAME code path — two implementations would
// drift and one of them would silently write a stale schema.
//
// Idempotent + version-tagged: a matching version tag is a no-op unless --force,
// which clears the fleet namespace first.
// ---------------------------------------------------------------------------

/** Bump when the key schema changes so an old dataset is never read as current. */
export const SEED_VERSION = 'v1';

/** Upstash REST caps request size, so hash/vehicle writes go out in batches. */
const BATCH_SIZE = 250;

export interface SeedOptions {
  force?: boolean;
}

export interface SeedResult {
  status: 'seeded' | 'skipped';
  version: string;
  bins: number;
  vehicles: number;
  regions: number;
  durationMs: number;
}

/**
 * Delete every fleet:* key. SCAN-based rather than FLUSHDB — the database may be
 * shared with other Marketplace-provisioned projects, and wiping someone else's
 * keyspace is not a recoverable mistake.
 */
export async function clearFleet(): Promise<number> {
  const r = getRedis();
  let cursor = '0';
  let deleted = 0;

  do {
    const [next, keys] = (await r.scan(cursor, {
      match: 'fleet:*',
      count: 500,
    })) as [string, string[]];
    cursor = String(next);
    if (keys.length > 0) {
      // Chunked DEL — one unbounded variadic call can exceed the REST body cap.
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const chunk = keys.slice(i, i + BATCH_SIZE);
        await r.del(...chunk);
        deleted += chunk.length;
      }
    }
  } while (cursor !== '0');

  return deleted;
}

/**
 * Write the deterministic fleet to Redis.
 *
 * Writes are pipelined in batches; the ordering (vehicles → bins → regions →
 * trends → index → meta) means the bins index and meta land LAST, so a partial
 * failure leaves the dataset unreadable rather than readable-but-wrong.
 */
export async function runSeed(options: SeedOptions = {}): Promise<SeedResult> {
  const started = Date.now();
  const r = getRedis();

  const existing = await r.get(KEYS.seedVersion);
  if (existing === SEED_VERSION && !options.force) {
    const binCount = (await r.scard(KEYS.binsIndex)) as number;
    return {
      status: 'skipped',
      version: SEED_VERSION,
      bins: binCount ?? 0,
      vehicles: 0,
      regions: 0,
      durationMs: Date.now() - started,
    };
  }

  if (options.force || existing) await clearFleet();

  const { bins, vehicles, vehiclesByBin, regions, trends } = generateFleet();

  // 1. Vehicle hashes. 25k hashes → batched pipelines.
  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const pipeline = r.pipeline();
    for (const v of vehicles.slice(i, i + BATCH_SIZE)) {
      pipeline.hset(KEYS.vehicle(v.id), {
        id: v.id,
        model: v.model,
        soc: v.soc,
        status: v.status,
        soh: v.soh,
        bin: v.bin,
        lat: v.lat,
        lng: v.lng,
      });
    }
    await pipeline.exec();
  }

  // 2. Bin hashes + per-bin vehicle lists (SOC-ascending, capped at 50).
  for (let i = 0; i < bins.length; i += 25) {
    const pipeline = r.pipeline();
    for (const b of bins.slice(i, i + 25)) {
      pipeline.hset(KEYS.bin(b.id), {
        lat: b.lat,
        lng: b.lng,
        vehicle_count: b.vehicle_count,
        avg_soh: b.avg_soh,
        open_exceptions: b.open_exceptions,
        region: b.region,
      });
      const list = vehiclesByBin.get(b.id) ?? [];
      if (list.length > 0) {
        pipeline.del(KEYS.binVehicles(b.id)); // idempotent: never append twice
        pipeline.rpush(KEYS.binVehicles(b.id), ...list.map((v) => v.id));
      }
    }
    await pipeline.exec();
  }

  // 3. Region summaries + 24h trend ring.
  const trendPipeline = r.pipeline();
  const oldestHour = Math.floor(Date.now() / 3_600_000) - TREND_WINDOW_HOURS;
  for (const region of regions) {
    trendPipeline.hset(KEYS.regionSummary(region.name), {
      vehicle_count: region.vehicle_count,
      alerts_per_1k: region.alerts_per_1k,
      share_pct: region.share_pct,
    });

    const points = trends.get(region.name) ?? [];
    if (points.length > 0) {
      // zadd's signature is (key, first, ...rest) — a variadic tuple, so the
      // first member has to be passed explicitly rather than spread.
      const members = points.map((p) => ({
        score: p.hour,
        member: encodeTrendMember(p),
      }));
      const [first, ...rest] = members;
      trendPipeline.zadd(KEYS.regionTrend(region.name), first, ...rest);
      // 24h ring (agents.md §2) — trim anything older than the window.
      trendPipeline.zremrangebyscore(KEYS.regionTrend(region.name), 0, oldestHour);
    }

  }
  await trendPipeline.exec();

  // 4. Bins index + meta + version tag — written last, in that order.
  const finalPipeline = r.pipeline();
  finalPipeline.del(KEYS.binsIndex);
  const [firstBinId, ...restBinIds] = bins.map((b) => b.id);
  finalPipeline.sadd(KEYS.binsIndex, firstBinId, ...restBinIds);

  finalPipeline.hset(KEYS.meta, {
    total_vehicles: vehicles.length,
    last_updated: Date.now(),
  });
  finalPipeline.set(KEYS.seedVersion, SEED_VERSION);
  await finalPipeline.exec();

  return {
    status: 'seeded',
    version: SEED_VERSION,
    bins: bins.length,
    vehicles: vehicles.length,
    regions: regions.length,
    durationMs: Date.now() - started,
  };
}
