import { NextResponse } from 'next/server';
import {
  getBin,
  getBinVehicles,
  getRegionTrend,
  isRedisConfigured,
} from '@/lib/redis';
import type { BinDetail } from '@/lib/types';

// GET /api/bin/:id → bin detail + vehicles + trend (agents.md §3).
//
// The lazy half of the read path: this is the only route that touches vehicle
// hashes, and only for ONE bin's vehicle list. The overview never pays
// that cost.
//
// The trend returned is the bin's REGION trend — the SortedSet is keyed by
// region (fleet:region:{name}:trend), and per-bin hourly history would be a
// different store's job (§9: Timescale/ClickHouse behind /api/trend).

export const revalidate = 5;

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

  const id = params.id;

  try {
    const bin = await getBin(id);
    if (!bin) {
      return NextResponse.json(
        { error: `No bin ${id}`, action: 'Reselect a hex on the map' },
        { status: 404 }
      );
    }

    // Independent reads — fire together rather than sequentially.
    const [vehicles, trend] = await Promise.all([
      getBinVehicles(id),
      getRegionTrend(bin.region),
    ]);

    const detail: BinDetail = { bin, vehicles, trend };

    return NextResponse.json(detail, {
      headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' },
    });
  } catch {
    return NextResponse.json(
      {
        error: 'Could not read bin detail',
        action: 'Reselect the hex to retry',
      },
      { status: 502 }
    );
  }
}
