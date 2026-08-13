// One-time helper to fetch an India states boundary file into /public.
// Not part of the app runtime or deploy. Tries a few Datameet-derived mirrors
// (Datameet open licence) and keeps the first that returns valid GeoJSON/TopoJSON.
// Writes /public/.geo-meta.json so the download can be verified without stdout.
import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'india-states.topo.json');
const META = path.join(process.cwd(), 'public', '.geo-meta.json');

const SOURCES = [
  // geohacker/india — Datameet-derived India state boundaries (GeoJSON).
  'https://raw.githubusercontent.com/geohacker/india/master/state/india_state.geojson',
  'https://cdn.jsdelivr.net/gh/geohacker/india@master/state/india_state.geojson',
  // udit-001/india-maps-data — maintained India state GeoJSON.
  'https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/states.geojson',
  // Datameet states GeoJSON (canonical source; larger).
  'https://raw.githubusercontent.com/datameet/maps/master/States/Admin2.geojson',
  // deldersveld topojson collection (compact TopoJSON).
  'https://raw.githubusercontent.com/deldersveld/topojson/master/countries/india/india-states.json',
];


async function tryFetch(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text); // throws if not JSON
  const type = json.type;
  if (type !== 'Topology' && type !== 'FeatureCollection') {
    throw new Error(`Unexpected GeoJSON type: ${type}`);
  }
  return { text, type };
}

async function main() {
  await mkdir(path.dirname(OUT), { recursive: true });
  let lastErr = null;
  for (const url of SOURCES) {
    try {
      const { text, type } = await tryFetch(url);
      await writeFile(OUT, text, 'utf8');
      const s = await stat(OUT);
      await writeFile(
        META,
        JSON.stringify({ ok: true, url, type, bytes: s.size }, null, 2),
        'utf8'
      );
      return;
    } catch (err) {
      lastErr = `${url} → ${err.message}`;
    }
  }
  await writeFile(META, JSON.stringify({ ok: false, error: lastErr }, null, 2), 'utf8');
  process.exitCode = 1;
}

main();
