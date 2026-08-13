# Fleet Console

Real-time EV fleet health dashboard for 25,000 vehicles across Indian fleet hubs. Built as a Next.js 14 app with a D3 SVG hex map, Zustand state, Upstash Redis for data, and SSE for live updates.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in Upstash + QStash values (see Environment below)
npm run seed
npm run dev
```

App runs at `http://localhost:3000`. Seeding is idempotent — re-running is safe. Use `npm run seed -- --force` to wipe and recreate the dataset.

---

## Environment

All variables live in `.env.local`. Copy from `.env.local.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST token |
| `QSTASH_TOKEN` | No | Enables QStash-scheduled writer (needed for real cron) |
| `QSTASH_CURRENT_SIGNING_KEY` | No | QStash webhook signature verification |
| `QSTASH_NEXT_SIGNING_KEY` | No | QStash webhook signature verification (key rotation) |
| `WRITER_SECRET` | No | Fallback auth for `/api/writer` without QStash |
| `SEED_SECRET` | No | Guards the `/api/seed` route in non-prod environments |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | No | Reverse geocoding for bin location labels (falls back to Nominatim) |

Provision Redis via the Vercel Marketplace Upstash integration. Do not use “Vercel KV” — it was deprecated and migrated to Upstash in late 2024.

---

## Architecture

### Shell and rendering

The server-rendered Next.js shell (`app/layout.tsx`, `app/page.tsx`) paints immediately with no data dependency. The map and sidebar are client components bootstrapped after hydration. This gives a fast first paint without needing to SSR the D3 layer, which is inherently client-side.

### Map: D3 SVG hexbin

The map (`app/components/map/`) is a plain D3 SVG — no tile provider, no API key. State outlines come from `public/india-states.topo.json`. Vehicle bins use `geoMercator` and `d3-hexbin`.

**D3 owns the hex subtree.** React renders an empty `<g>` once. D3 applies hex paths, fill/opacity, transitions, and SSE updates via refs and an out-of-React `store.subscribe`; React does not reconcile the hex layer on live data ticks.

**Dual-channel colour encoding:**

- **Fill hue** → fleet health, encoded from avg SOC adjusted for stranded vehicle pressure. Scale runs red (critical) → amber (marginal) → green (healthy).
- **Fill opacity** → vehicle density, normalised across visible bins.

A dense unhealthy bin is solid red; a sparse healthy bin is faint green. The view mode toggle supports Combined, Health only, and Density only.

**Zoom tiers:** Three discrete tiers in `lib/hexbin.ts` use different radii. Pan/zoom within a tier is a pure SVG transform; re-binning happens only at tier boundaries and is debounced at 120ms.

### State: Zustand

`store/fleetStore.ts` holds bins, region rollups, selection, hover, view mode, zoom tier, and filters. Filters are mirrored to URL query params via `store/useUrlSync.ts`. SSE diffs mutate bins in place and bump `diffVersion`; D3 subscribes outside React and runs transitions.

### Data: Upstash Redis

```
fleet:meta                    Hash    { total_vehicles, last_updated }
fleet:bin:{id}                Hash    { lat, lng, vehicle_count, avg_soh, avg_soc, open_exceptions, region, ... }
fleet:bins:index              Set     all bin IDs
fleet:vehicles:{bin_id}       List    capped at 50 vehicles, sorted ascending by SOC
fleet:region:{name}           Hash    region rollup { vehicle_count, alerts_per_1k, share_of_fleet }
fleet:trend:{region}          ZSet    24h of hourly avg-SOC readings (score = unix timestamp)
fleet:diff:latest             String  JSON of the most recent writer diff
fleet:writer:lock             String  distributed lock (short TTL) preventing concurrent writes
fleet:seed:version            String  version tag written last; absence means seed is incomplete
```

All reads use the `@upstash/redis` REST client from serverless functions. There is no persistent Redis connection.

### Realtime: writer/reader split

`/api/writer` (POST) is the only mutation route. It locks Redis, mutates 3–5 bins, updates rollups, writes the diff, and releases the lock. Production invokes it through QStash; the SSE connect-time kick provides demo freshness.

`/api/stream` (GET) is a pure SSE reader. It sends the full snapshot on connect, polls the diff every 5 seconds, and pushes changed bins. It never writes to Redis, so N viewers create N readers, not N writers.

### Data generation

`scripts/seed.ts` uses `@faker-js/faker` with `faker.seed(42)` for deterministic data. It writes bin hashes, SOC-sorted vehicle lists, region rollups, and 24h trends in one pipelined pass. `--force` clears fleet keys with SCAN+DEL rather than FLUSHDB.

---

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/bins` | GET | All bin summaries, region rollups, and meta; revalidates every 5s. |
| `/api/bin/[id]` | GET | Capped SOC-ascending vehicle list and 24h trend, fetched lazily. |
| `/api/stream` | GET | SSE snapshot on connect and diffs every 5s; Node runtime. |
| `/api/writer` | POST | QStash webhook mutation target with signature verification; Node runtime. |
| `/api/seed` | POST | Non-production seeding route gated by `SEED_SECRET`. |

---

## Checks

```bash
npm run test          # Vitest unit + component tests
npm run test:e2e      # Playwright E2E against a local Next server (Redis routes mocked)
npx tsc --noEmit      # TypeScript
npm run build         # Production bundle
```

---

## Production boundaries (named, not hidden)

- **SSE fan-out:** Each connection is a serverless invocation polling Redis independently. At scale, use a persistent WebSocket process or managed pub/sub such as Ably, Pusher, or PartyKit.
- **Redis REST vs SUBSCRIBE:** Upstash REST cannot hold a persistent `SUBSCRIBE`, so this polls the diff document. Kafka or Redis Streams belongs in a high-frequency ingestion path.
- **QStash minimum interval:** The free tier minimum is 60 seconds. The 5s SSE poll lets the demo see changes within 5 seconds of the writer landing them.
- **Trend store:** The 24h SortedSet is a sparkline cache. Cross-dimension analytics belong in Timescale or ClickHouse.
- **Bin IDs:** Seeded placeholders are based on geographic centroids. Production ingestion should use H3 cell IDs for spatially consistent bins.
