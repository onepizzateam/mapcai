import { beforeEach, describe, expect, it, vi } from 'vitest';

// seed idempotency (agents.md §11 test checklist).
//
// Two properties are worth locking down:
//
//   1. Determinism — faker.seed(42) means every reviewer gets byte-identical
//      data. If this drifts, "reproducible across reviewers" (§2) is a lie.
//   2. Idempotency — re-running the seeder against an already-seeded database is
//      a no-op unless --force, and --force clears by SCAN rather than FLUSHDB
//      (the Upstash database may be shared with other Marketplace projects).
//
// Redis is faked in-process rather than mocked call-by-call: asserting on a
// recorded call list would pin the implementation, whereas a fake lets the test
// assert on the resulting state, which is what actually matters.

interface FakeRedisState {
  strings: Map<string, string>;
  hashes: Map<string, Record<string, string>>;
  lists: Map<string, string[]>;
  sets: Map<string, Set<string>>;
  zsets: Map<string, Map<string, number>>;
  deletes: number;
  flushed: boolean;
}

const state: FakeRedisState = {
  strings: new Map(),
  hashes: new Map(),
  lists: new Map(),
  sets: new Map(),
  zsets: new Map(),
  deletes: 0,
  flushed: false,
};

function reset() {
  state.strings.clear();
  state.hashes.clear();
  state.lists.clear();
  state.sets.clear();
  state.zsets.clear();
  state.deletes = 0;
  state.flushed = false;
}

function allKeys(): string[] {
  return [
    ...state.strings.keys(),
    ...state.hashes.keys(),
    ...state.lists.keys(),
    ...state.sets.keys(),
    ...state.zsets.keys(),
  ];
}

function del(...keys: string[]) {
  for (const key of keys) {
    const existed =
      state.strings.delete(key) ||
      state.hashes.delete(key) ||
      state.lists.delete(key) ||
      state.sets.delete(key) ||
      state.zsets.delete(key);
    if (existed) state.deletes += 1;
  }
}

/** Commands shared by the client and its pipeline (a pipeline is just a queue). */
const commands = {
  hset(key: string, value: Record<string, unknown>) {
    const existing = state.hashes.get(key) ?? {};
    for (const [k, v] of Object.entries(value)) existing[k] = String(v);
    state.hashes.set(key, existing);
  },
  set(key: string, value: unknown) {
    state.strings.set(key, String(value));
  },
  rpush(key: string, ...values: string[]) {
    state.lists.set(key, [...(state.lists.get(key) ?? []), ...values]);
  },
  sadd(key: string, ...members: string[]) {
    const set = state.sets.get(key) ?? new Set<string>();
    for (const m of members) set.add(m);
    state.sets.set(key, set);
  },
  zadd(
    key: string,
    ...entries: { score: number; member: string }[]
  ) {
    const zset = state.zsets.get(key) ?? new Map<string, number>();
    for (const e of entries.flat()) zset.set(e.member, e.score);
    state.zsets.set(key, zset);
  },
  zremrangebyscore(key: string, min: number, max: number) {
    const zset = state.zsets.get(key);
    if (!zset) return;
    for (const [member, score] of zset) {
      if (score >= min && score <= max) zset.delete(member);
    }
  },
  del,
};

function makePipeline() {
  const queue: (() => void)[] = [];
  const pipeline = {
    ...Object.fromEntries(
      Object.entries(commands).map(([name, fn]) => [
        name,
        (...args: unknown[]) => {
          queue.push(() => (fn as (...a: unknown[]) => void)(...args));
          return pipeline;
        },
      ]),
    ),
    exec: async () => {
      for (const run of queue) run();
      queue.length = 0;
      return [];
    },
  } as Record<string, unknown> & { exec: () => Promise<unknown[]> };
  return pipeline;
}

const fakeRedis = {
  ...commands,
  async get(key: string) {
    return state.strings.get(key) ?? null;
  },
  async scard(key: string) {
    return state.sets.get(key)?.size ?? 0;
  },
  async scan(_cursor: string, opts: { match: string }) {
    const prefix = opts.match.replace(/\*$/, '');
    return ['0', allKeys().filter((k) => k.startsWith(prefix))] as [string, string[]];
  },
  async flushdb() {
    state.flushed = true;
  },
  pipeline: makePipeline,
};

vi.mock('@/lib/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redis')>();
  return { ...actual, getRedis: () => fakeRedis, isRedisConfigured: () => true };
});

const { runSeed, SEED_VERSION } = await import('@/lib/seedRunner');
const { BIN_COUNT, TOTAL_VEHICLES, VEHICLE_LIST_CAP, generateFleet } = await import(
  '@/lib/faker/seed'
);

beforeEach(reset);

describe('generateFleet determinism', () => {
  it('produces identical data across runs — same seed, same fleet', () => {
    const a = generateFleet();
    const b = generateFleet();

    expect(a.bins).toEqual(b.bins);
    expect(a.vehicles.length).toBe(b.vehicles.length);
    expect(a.vehicles[0]).toEqual(b.vehicles[0]);
    expect(a.vehicles.at(-1)).toEqual(b.vehicles.at(-1));
  });

  it('matches the volumes the spec promises', () => {
    const { bins, vehicles, regions, trends } = generateFleet();

    expect(bins.length).toBeGreaterThanOrEqual(BIN_COUNT - 15);
    expect(bins.length).toBeLessThanOrEqual(BIN_COUNT + 15);
    // Rounding per-bin shares can't hit 25,000 exactly; ±1% is the honest bound.
    expect(vehicles.length).toBeGreaterThan(TOTAL_VEHICLES * 0.99);
    expect(vehicles.length).toBeLessThan(TOTAL_VEHICLES * 1.01);
    expect(regions).toHaveLength(8);

    // 24h of hourly trend per region, so the sparkline is populated on first load.
    for (const points of trends.values()) expect(points).toHaveLength(24);
  });

  it('preserves meaningful variation in vehicle counts across bins', () => {
    const { bins } = generateFleet();
    const counts = bins.map((bin) => bin.vehicle_count);
    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const standardDeviation = Math.sqrt(
      counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / counts.length,
    );

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(TOTAL_VEHICLES);
    expect(standardDeviation).toBeGreaterThan(25);
    expect(counts.some((count) => count > 50)).toBe(true);
    expect(counts.filter((count) => count === 50).length).toBeLessThan(counts.length);
  });

  it('caps and SOC-sorts each per-bin vehicle list', () => {
    const { bins, vehiclesByBin } = generateFleet();
    const list = vehiclesByBin.get(bins[0].id)!;

    expect(list.length).toBeLessThanOrEqual(VEHICLE_LIST_CAP);
    // Ascending SOC on write means the API needs no sort on read (§2, §6).
    const socs = list.map((v) => v.soc);
    expect([...socs].sort((a, b) => a - b)).toEqual(socs);
  });
});

describe('runSeed', () => {
  it('writes the version tag last so a partial run reads as unseeded', async () => {
    const result = await runSeed();

    expect(result.status).toBe('seeded');
    expect(result.version).toBe(SEED_VERSION);
    expect(state.strings.get('fleet:seed:version')).toBe(SEED_VERSION);
    expect(state.hashes.has('fleet:meta')).toBe(true);
    expect(state.sets.get('fleet:bins:index')!.size).toBe(result.bins);
  });

  it('is a no-op on re-run at the same version', async () => {
    const first = await runSeed();
    const deletesAfterFirst = state.deletes;

    const second = await runSeed();

    expect(second.status).toBe('skipped');
    expect(second.bins).toBe(first.bins);
    // Nothing cleared, nothing rewritten — the point of the version tag.
    expect(state.deletes).toBe(deletesAfterFirst);
  });

  it('clears and rewrites under --force', async () => {
    await runSeed();
    const deletesAfterFirst = state.deletes;

    const forced = await runSeed({ force: true });

    expect(forced.status).toBe('seeded');
    expect(state.deletes).toBeGreaterThan(deletesAfterFirst);
    // SCAN + DEL, never FLUSHDB — the database may not be ours alone.
    expect(state.flushed).toBe(false);
  });

  it('leaves foreign keys untouched when clearing', async () => {
    state.strings.set('someone-elses:key', 'do not touch');
    await runSeed();
    await runSeed({ force: true });

    expect(state.strings.get('someone-elses:key')).toBe('do not touch');
  });

  it('produces the same bin count on a forced re-seed', async () => {
    const first = await runSeed();
    const forced = await runSeed({ force: true });

    // Determinism end to end: force-reseeding can't quietly change the dataset.
    expect(forced.bins).toBe(first.bins);
    expect(forced.vehicles).toBe(first.vehicles);
  });
});
