// One-time build helper: simplify the raw India states GeoJSON into a compact
// TopoJSON that meets the ~40KB-gzipped budget (agents.md §8). Shells out to the
// mapshaper CLI via `npx` so it stays a build-time tool, not an app dependency.
// Not part of the app runtime or deploy. Writes /public/.geo-meta.json so the
// result can be verified without relying on stdout.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RAW = path.join(process.cwd(), 'public', '.india-raw.geojson');
const OUT = path.join(process.cwd(), 'public', 'india-states.topo.json');
const META = path.join(process.cwd(), 'public', '.geo-meta.json');

async function main() {
  // Visvalingam simplification, keep every shape (no dropped states/islands),
  // quantize + drop attribute tables to shrink the TopoJSON aggressively.
  const args = [
    '-y',
    'mapshaper',
    RAW,
    '-simplify',
    '2%',
    'visvalingam',
    'keep-shapes',
    '-clean',
    '-o',
    OUT,
    'format=topojson',
    'drop-table',
    'quantization=1e4',
  ];

  // npx is a .cmd shim on Windows — run through the shell so it resolves.
  execFileSync('npx', args, { stdio: 'inherit', shell: true });

  const topo = await readFile(OUT);
  const s = await stat(OUT);
  const gz = gzipSync(topo).length;
  await writeFile(
    META,
    JSON.stringify(
      { ok: true, bytes: s.size, gzipBytes: gz, budgetGzip: 40 * 1024 },
      null,
      2
    ),
    'utf8'
  );
}

main().catch(async (err) => {
  await writeFile(META, JSON.stringify({ ok: false, error: String(err) }, null, 2), 'utf8');
  process.exitCode = 1;
});
