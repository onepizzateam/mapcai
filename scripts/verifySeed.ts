import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Redis } from '@upstash/redis';

function loadEnvFile(): void {
  const file = resolve(process.cwd(), '.env.local');
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1).replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL as string,
    token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
  });
  const ids = (await redis.smembers('fleet:bins:index')) as string[];
  if (ids.length === 0) throw new Error('fleet:bins:index is empty');

  const sampleId = ids[0];
  const bin = await redis.hgetall(`fleet:bin:${sampleId}`) as Record<string, unknown>;
  const vehicleIds = await redis.lrange(`fleet:bin:${sampleId}:vehicles`, 0, -1) as string[];
  const vehicle = await redis.hgetall(`fleet:vehicle:${vehicleIds[0]}`) as Record<string, unknown>;
  const region = String(bin.region);
  const trend = await redis.zrange(`fleet:region:${region}:trend`, 0, -1, { withScores: true });
  const meta = await redis.hgetall('fleet:meta');
  const version = await redis.get('fleet:seed:version');

  const requiredBinFields = ['lat', 'lng', 'vehicle_count', 'avg_soh', 'open_exceptions', 'region'];
  const requiredVehicleFields = ['id', 'model', 'soc', 'status', 'soh', 'bin', 'lat', 'lng'];
  for (const field of requiredBinFields) if (!(field in bin)) throw new Error(`Missing bin field: ${field}`);
  for (const field of requiredVehicleFields) if (!(field in vehicle)) throw new Error(`Missing vehicle field: ${field}`);
  if (vehicleIds.length > 50) throw new Error(`Vehicle list exceeds cap: ${vehicleIds.length}`);
  if (trend.length < 24) throw new Error(`Trend has fewer than 24 values: ${trend.length}`);
  if (!meta || !('total_vehicles' in meta) || !('last_updated' in meta)) throw new Error('Invalid fleet:meta hash');
  if (version !== 'v1') throw new Error(`Unexpected seed version: ${String(version)}`);

  console.log(JSON.stringify({ bins: ids.length, sampleBin: sampleId, vehicleListSize: vehicleIds.length, trendValues: trend.length / 2, metaPresent: true, seedVersion: version }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
