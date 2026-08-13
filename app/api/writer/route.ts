import { NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';
import {
  acquireWriterLock,
  commitMutations,
  getAllBins,
  getBinVehicles,
  isRedisConfigured,
  releaseWriterLock,
  setLatestDiff,
  type BinMutation,
} from '@/lib/redis';
import { rollupRegions } from '@/lib/faker/seed';
import type { BinDiff, BinSummary, FleetDiff, Vehicle, VehicleStatus } from '@/lib/types';

// POST /api/writer — QStash webhook target (agents.md §5).
//
// THE SINGLE MUTATION SOURCE. No other route writes to Redis. The naive design
// puts this loop inside the SSE handler, which means every connected client runs
// its own writer: two tabs = two uncoordinated mutation loops at 2× the intended
// rate. That's broken at two users, not merely unscalable — hence the strict
// writer/reader split and the distributed lock below.
//
// Node runtime: crypto for the QStash signature check, and no Edge constraints
// to work around.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bins mutated per tick (agents.md §5: "mutate 3–5 bins"). */
const MIN_BINS = 3;
const MAX_BINS = 5;
/** Vehicles re-simulated per mutated bin — the list is capped at 50 anyway. */
const VEHICLES_PER_BIN = 12;

export async function POST(request: Request) {
  if (!isRedisConfigured()) {
    return NextResponse.json(
      { error: 'Fleet data store not configured' },
      { status: 503 }
    );
  }

  const body = await request.text();

  const authorised = await isAuthorised(request, body);
  if (!authorised) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  // Distributed lock (SET NX EX 6): if QStash retries because a previous
  // invocation was slow, the retry sees the lock and returns 200 without
  // double-writing. 200, not 409 — a retry that correctly did nothing is a
  // success, and a non-2xx would make QStash retry again.
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const locked = await acquireWriterLock(token);
  if (!locked) {
    return NextResponse.json({ status: 'skipped', reason: 'writer-locked' });
  }

  try {
    const bins = await getAllBins();
    if (bins.length === 0) {
      return NextResponse.json(
        { status: 'skipped', reason: 'empty-dataset', action: 'Run: npm run seed' },
        { status: 503 }
      );
    }

    const ts = Date.now();
    const targets = pickTargets(bins);

    const mutations: BinMutation[] = [];
    const diffs: BinDiff[] = [];
    const alerts: string[] = [];

    for (const bin of targets) {
      const vehicles = await getBinVehicles(bin.id);
      const mutated = mutateBin(bin, vehicles, ts);
      mutations.push(mutated.mutation);
      diffs.push(mutated.diff);
      alerts.push(...mutated.alerts);
    }

    // Region rollups recomputed from the post-mutation bin set, so
    // alerts-per-1k in the sidebar always agrees with the map.
    const mutatedById = new Map(mutations.map((m) => [m.id, m]));
    const nextBins: BinSummary[] = bins.map((b) => {
      const m = mutatedById.get(b.id);
      return m
        ? {
            ...b,
            vehicle_count: m.vehicle_count,
            avg_soh: m.avg_soh,
            open_exceptions: m.open_exceptions,
          }
        : b;
    });
    const regions = rollupRegions(nextBins);

    await commitMutations(mutations, regions, alerts, ts);

    // The diff document the SSE reader polls. ts doubles as the ETag.
    const diff: FleetDiff = { ts, bins: diffs };
    await setLatestDiff(diff);

    return NextResponse.json({ status: 'ok', ts, mutated: diffs.length });
  } catch {
    return NextResponse.json({ error: 'Writer tick failed' }, { status: 500 });
  } finally {
    // Always release, even on throw — otherwise the next 6s of ticks no-op.
    await releaseWriterLock(token);
  }
}

/**
 * Two accepted callers:
 *   1. QStash — verified by signature (QSTASH_CURRENT/NEXT_SIGNING_KEY).
 *   2. A manual trigger carrying `x-writer-secret: WRITER_SECRET`, so the demo
 *      can be advanced on demand without waiting out QStash's 60s minimum.
 *
 * If neither set of keys is configured, the route is closed rather than open:
 * failing shut is the only safe default for the one endpoint that can write.
 */
async function isAuthorised(request: Request, body: string): Promise<boolean> {
  const writerSecret = process.env.WRITER_SECRET;
  const provided = request.headers.get('x-writer-secret');
  if (writerSecret && provided && timingSafeEqual(provided, writerSecret)) {
    return true;
  }

  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  const signature = request.headers.get('upstash-signature');
  if (!currentKey || !nextKey || !signature) return false;

  try {
    const receiver = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey: nextKey,
    });
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}

/** Constant-time string compare — no early return on first mismatched byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Pick 3–5 bins. Weighted toward the largest bins so the visible hexes are the
 * ones that move — a random pick across ~90 bins mostly animates hexes the
 * reviewer isn't looking at.
 */
function pickTargets(bins: BinSummary[]): BinSummary[] {
  const count = MIN_BINS + Math.floor(Math.random() * (MAX_BINS - MIN_BINS + 1));
  const pool = [...bins]
    .sort((a, b) => b.vehicle_count - a.vehicle_count)
    .slice(0, Math.max(count * 4, 20));

  const picked: BinSummary[] = [];
  while (picked.length < count && pool.length > 0) {
    const [bin] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    picked.push(bin);
  }
  return picked;
}

interface MutationResult {
  mutation: BinMutation;
  diff: BinDiff;
  alerts: string[];
}

/**
 * Simulate one bin's tick: SOC drift, status flips, small SOH decay, and an
 * exception delta. This is a fake mutator standing in for a telemetry consumer —
 * §9 is explicit that real ingestion is Kafka → consumer → Redis, and that this
 * is not that.
 */
function mutateBin(bin: BinSummary, vehicles: Vehicle[], ts: number): MutationResult {
  const sample = vehicles.slice(0, VEHICLES_PER_BIN);
  const alerts: string[] = [];

  const updated: Vehicle[] = sample.map((v) => {
    let soc = v.soc;
    let status = v.status;

    // Charging climbs, driving drains, parked idles — direction follows state.
    if (status === 'charging') soc += rand(1.5, 6);
    else if (status === 'driving') soc -= rand(0.8, 4.5);
    else soc -= rand(0, 0.4);

    soc = clamp(soc, 1, 100);

    // Status flips at the edges: a driving vehicle that drains plugs in, a
    // charging vehicle that fills up rejoins the road.
    if (status === 'driving' && soc < 15 && Math.random() < 0.55) status = 'charging';
    else if (status === 'charging' && soc > 92 && Math.random() < 0.6) status = 'driving';
    else if (Math.random() < 0.05) status = flip(status);

    // SOH decays far slower than SOC — a battery doesn't age in 60 seconds.
    const soh = clamp(v.soh - rand(0, 0.05), 50, 100);

    if (soc < 15 && v.soc >= 15) {
      alerts.push(
        JSON.stringify({
          ts,
          bin: bin.id,
          vehicle: v.id,
          type: 'low_soc',
          soc: round(soc, 1),
        })
      );
    }

    return { ...v, soc: round(soc, 1), status, soh: round(soh, 1) };
  });

  // Bin avg SOH: blend the re-simulated sample into the existing average,
  // weighted by the share of the bin the sample represents. Overwriting the
  // whole bin's SOH from 12 vehicles would misreport a 2,000-vehicle bin.
  const sampleAvg =
    updated.length > 0 ? updated.reduce((s, v) => s + v.soh, 0) / updated.length : bin.avg_soh;
  const sampleWeight = Math.min(1, updated.length / Math.max(bin.vehicle_count, 1));
  const avgSoh = round(bin.avg_soh * (1 - sampleWeight) + sampleAvg * sampleWeight, 1);

  // Exceptions drift by ±2 and never go negative.
  const excDelta = Math.round(rand(-2, 2));
  const openExceptions = Math.max(0, bin.open_exceptions + excDelta);

  // Vehicle count drifts slightly — vehicles enter and leave a geographic bin.
  const countDelta = Math.round(rand(-3, 3));
  const vehicleCount = Math.max(1, bin.vehicle_count + countDelta);
  const avgSoc = updated.length > 0 ? round(updated.reduce((sum, v) => sum + v.soc, 0) / updated.length, 1) : (bin.avg_soc ?? 0);
  const strandedCount = updated.filter((v) => v.soc < 8 && v.status !== 'charging').length;
  const criticalSocCount = updated.filter((v) => v.soc < 20).length;
  const chargingCount = updated.filter((v) => v.status === 'charging').length;

  return {
    mutation: {
      id: bin.id,
      region: bin.region,
      vehicle_count: vehicleCount,
      avg_soh: avgSoh,
      open_exceptions: openExceptions,
      vehicles: updated,
      avg_soc: avgSoc, stranded_count: strandedCount, critical_soc_count: criticalSocCount, charging_count: chargingCount,
    },
    diff: {
      id: bin.id,
      vehicle_count: vehicleCount,
      avg_soh: avgSoh,
      open_exceptions: openExceptions,
      avg_soc: avgSoc, stranded_count: strandedCount, critical_soc_count: criticalSocCount, charging_count: chargingCount,
    },
    alerts,
  };
}

function flip(status: VehicleStatus): VehicleStatus {
  const options: VehicleStatus[] = ['driving', 'charging', 'parked'];
  const others = options.filter((s) => s !== status);
  return others[Math.floor(Math.random() * others.length)];
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
