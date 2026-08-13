/**
 * Seeder CLI (agents.md §2, §11):  npx tsx scripts/seed.ts [--force]
 *
 * A thin wrapper around lib/seedRunner — all the write logic lives there so the
 * CLI and /api/seed can never diverge. Run once locally; never invoked on deploy.
 *
 * console.* here is the intended output channel: this is dev tooling, not an
 * application path, so the no-console rule doesn't apply.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSeed } from '../lib/seedRunner';
import { generateBins } from '../lib/faker/seed';
import { REGION_BOUNDS } from '../lib/regions';
import { isRedisConfigured } from '../lib/redis';

/**
 * Minimal .env.local loader. Deliberately not dotenv: adding a dependency to
 * read seven lines of KEY=value isn't worth the install, and Next already loads
 * these files for the app itself — only this standalone script needs them.
 */
function loadEnvFile(file: string): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    return; // absent is fine — the shell may already export the vars
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value; // shell wins
  }
}

async function main(): Promise<void> {
  loadEnvFile('.env.local');

  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      [
        'Usage: npx tsx scripts/seed.ts [--force]',
        '',
        '  --force   Clear every fleet:* key and re-seed, even if the version tag matches.',
        '',
        'Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local.',
      ].join('\n')
    );
    return;
  }

  if (!isRedisConfigured()) {
    console.error(
      'Missing Upstash credentials.\n' +
        'Copy .env.local.example to .env.local, then set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN\n' +
        '(Vercel → Storage → Upstash Redis → .env.local snippet).'
    );
    process.exitCode = 1;
    return;
  }

  const force = args.includes('--force');
  if (force) {
    console.log('First five bin coordinates:');
    for (const bin of generateBins().slice(0, 5)) {
      const bounds = REGION_BOUNDS[bin.region];
      const inside = bin.lat > bounds.latMin && bin.lat < bounds.latMax && bin.lng > bounds.lngMin && bin.lng < bounds.lngMax;
      console.log(`  ${bin.id} ${bin.region}: ${bin.lat}, ${bin.lng} ${inside ? 'OK' : 'OUT OF BOUNDS'}`);
    }
  }
  console.log(force ? 'Seeding (forced re-seed)…' : 'Seeding…');

  const result = await runSeed({ force });

  if (result.status === 'skipped') {
    console.log(
      `Already seeded at version ${result.version} (${result.bins} bins). Pass --force to re-seed.`
    );
    return;
  }

  console.log(
    `Seeded ${result.vehicles.toLocaleString()} vehicles across ${result.bins} bins ` +
      `and ${result.regions} regions in ${(result.durationMs / 1000).toFixed(1)}s ` +
      `(version ${result.version}).`
  );
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
