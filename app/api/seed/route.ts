import { NextResponse } from 'next/server';
import { isRedisConfigured } from '@/lib/redis';
import { runSeed } from '@/lib/seedRunner';

// POST /api/seed — non-prod only (agents.md §2).
//
// DUAL GUARD, both required:
//   1. process.env.NODE_ENV !== 'production'
//   2. x-seed-secret header matching SEED_SECRET
//
// Either alone is insufficient: the env check alone would leave a preview deploy
// (which builds as production) writable by anyone who guesses the path, and the
// secret alone would leave a rotated/leaked key able to wipe prod data. Both,
// and a missing SEED_SECRET closes the route rather than opening it.
//
// Never called from the client. The CLI (npm run seed) is the intended path;
// this exists for seeding a local/preview instance over HTTP.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Guard 1 — environment.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Guard 2 — shared secret. Absent config = closed, not open.
  const expected = process.env.SEED_SECRET;
  const provided = request.headers.get('x-seed-secret');
  if (!expected || !provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!isRedisConfigured()) {
    return NextResponse.json(
      {
        error: 'Fleet data store not configured',
        action: 'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
      },
      { status: 503 }
    );
  }

  const force = new URL(request.url).searchParams.get('force') === 'true';

  try {
    const result = await runSeed({ force });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: 'Seed failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/** Constant-time compare — no early return on the first mismatched byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
