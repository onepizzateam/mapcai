import { NextResponse } from 'next/server';
import {
  getAllBins,
  getMeta,
  getRegionSummaries,
  isRedisConfigured,
} from '@/lib/redis';
import type { BinsSnapshot } from '@/lib/types';

// GET /api/bins → all bin summaries + region rollups + meta (agents.md §3).
//
// The hot read path. Three pipelined reads, O(n_bins) not O(n_vehicles) (§2, §10)
// — ~90 bin hashes, never the 25k vehicle hashes. Stateless, so it is exactly
// what serverless is good at.
//
// revalidate = 5 matches the writer cadence: the SSE stream carries live diffs,
// so this route only needs to be fresh enough for a cold page load.

export const revalidate = 5;

export async function GET() {
  if (!isRedisConfigured()) {
    return NextResponse.json(
      {
        error: 'Fleet data store not configured',
        action:
          'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local, then run: npm run seed',
      },
      { status: 503 }
    );
  }

  try {
    const [bins, regions, meta] = await Promise.all([
      getAllBins(),
      getRegionSummaries(),
      getMeta(),
    ]);

    if (bins.length === 0) {
      return NextResponse.json(
        {
          error: 'Fleet data store is empty',
          action: 'Run: npm run seed',
        },
        { status: 503 }
      );
    }

    const snapshot: BinsSnapshot = {
      bins,
      regions,
      meta: {
        // meta.total_vehicles is authoritative; fall back to the bin rollup if
        // the hash is missing so the topbar never reads zero on live data.
        total_vehicles:
          meta.total_vehicles || bins.reduce((s, b) => s + b.vehicle_count, 0),
        last_updated: meta.last_updated || Date.now(),
      },
    };

    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' },
    });
  } catch {
    return NextResponse.json
      (
        {
          error: 'Could not read fleet snapshot',
          action: 'Retry in a moment — the live feed will reconnect automatically',
        },
        { status: 502 }
      );
  }
}
