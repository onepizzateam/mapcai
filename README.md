# Fleet Console

Real-time EV battery/fleet health map for 25,000 vehicles, built as a D3 SVG hex map inside a Next.js 14 app, with a Zustand store, Upstash Redis for data, and SSE for live updates.

Live demo: https://map-demo-3nwomb1kd-palak-jhas-projects.vercel.app

> The live SSE feed is currently idle on the deployed demo (see [Known limitations](#known-limitations) — it's a free-tier hosting constraint, not a design gap). Run it locally with `npm run seed` and the QStash writer enabled to see the full real-time path.

---

## What this is

A take-home for a map-based battery analytics dashboard, built to be improved on and evaluated by a Frontend/UX lead. Starting point was a purple, single-hue reference screenshot (single-country, India-only). This implementation:

- Replaces the single-hue fill with a **dual-channel encoding** (hue = fleet health, opacity = vehicle density), so a dense-and-unhealthy region and a sparse-but-healthy one are visually distinguishable at a glance.
- Adds **country/region drill-down** (world → country → zone → hex → bin → vehicle) that wasn't in the reference — global support wasn't required but was straightforward to add given the projection/topojson approach, so it's in.
- Treats the map as a **real-time surface**, not a static snapshot: SSE-driven diffs recolor the map without a React re-render.
- Is keyboard-navigable and screen-reader-usable, not just mouse-driven.

For the full architecture rationale, trade-offs, and an honest list of what's solid vs. what's a known shortcut, see **[writeup.md](./writeup.md)**.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in Upstash + (optionally) QStash values
npm run seed                       # deterministic 25k-vehicle dataset (faker.seed(42))
npm run dev
```

App runs at `http://localhost:3000`. Seeding is idempotent — re-running is safe. `npm run seed -- --force` wipes and recreates the dataset (via SCAN+DEL, not FLUSHDB, since the Upstash database may be shared).

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run seed` | Seed Redis with the deterministic dataset |
| `npm run verify:seed` | Sanity-check the seeded data against expected invariants |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run lint` | Next/ESLint |

---

## Environment

All variables live in `.env.local` — copy from `.env.local.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST token |
| `QSTASH_TOKEN` | No | Enables the QStash-scheduled writer (needed for real ongoing live updates) |
| `QSTASH_CURRENT_SIGNING_KEY` | No | QStash webhook signature verification |
| `QSTASH_NEXT_SIGNING_KEY` | No | QStash webhook signature verification (key rotation) |
| `WRITER_SECRET` | No | Fallback auth for `/api/writer`, used by the SSE connect-time demo kick |
| `SEED_SECRET` | No | Guards `/api/seed` in non-local environments |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | No | Reverse geocoding for bin location labels (falls back to Nominatim) |

Provision Redis via the Vercel Marketplace Upstash integration — not "Vercel KV" (deprecated, migrated to Upstash in late 2024).

**If you deploy this and want the live feed to actually move:** set `WRITER_SECRET` (or QStash) on the deployment. Without it, `/api/writer` is unreachable from the SSE route's connect-time kick and the UI will correctly show "Live" with 0 updates — the wiring is real, it's just not authorized on a bare free-tier deploy. See [writeup.md § Known limitations](./writeup.md#known-limitations) for the full explanation.

---

## Architecture at a glance

```
Redis (Upstash)  ──▶  /api/bins, /api/bin/:id   (cold read / drill-down)
      ▲                /api/stream               (SSE: snapshot + diffs)
      │
   /api/writer   ◀── QStash cron (or SSE connect-time demo kick)
```

- **Shell:** `app/layout.tsx` / `app/page.tsx` are a server-rendered, data-free shell. Map and sidebar hydrate as client islands.
- **Map:** plain D3 SVG (`app/components/map/`), no tile provider, no map API key. `geoMercator` + `d3-hexbin` project vehicle bins onto `public/world-countries.topo.json` / `public/india-states.topo.json` outlines.
- **D3 owns the hex subtree.** React renders one empty `<g>`; D3 handles enter/update/exit, fill/opacity, and SSE-driven transitions via refs and an out-of-React `store.subscribe`. React never reconciles the hex layer on a live tick.
- **State:** Zustand (`store/fleetStore.ts`) — bins are a mutable array D3 reads by reference; `applyDiff` mutates in place and bumps a `diffVersion` counter that only the D3 subscription watches.
- **Data:** Upstash Redis, read via the REST client from serverless functions (no persistent connection). Schema and full reasoning in writeup.md.
- **Realtime:** strict reader/writer split. `/api/writer` (POST) is the only mutation path; `/api/stream` (GET) is a pure SSE reader that never writes, so N viewers = N readers, not N writers.

Full detail — including the two things I'd flag to a reviewer myself before they ask — is in **[writeup.md](./writeup.md)**.

---

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/bins` | GET | All bin summaries, region rollups, meta. `revalidate = 5`. |
| `/api/bin/[id]` | GET | Single bin's vehicle list (SOC-ascending, capped) + 24h trend. Lazy — never paid for on the overview. |
| `/api/stream` | GET | SSE: full snapshot on connect, diffs pushed on change. Node runtime (Edge can't hold the connection open). |
| `/api/writer` | POST | The only mutation route. QStash webhook target in production; manual-secret fallback for the demo kick. |
| `/api/seed` | POST | Non-production seeding, gated by `SEED_SECRET`. |

---

## Testing

- **Unit (Vitest):** color scale math, seed determinism/idempotency, the HexLayer SSE→transition contract, sidebar drill-down, URL↔filter sync.
- **E2E (Playwright):** load → filter a region → drill into a bin → vehicle list renders, against mocked `/api/bins`, `/api/bin/:id`, `/api/stream`.
- **Types:** `tsc --noEmit` clean.
- **Build:** `next build` compiles; first-load JS ~132 kB.

Run `npm run test` and `npm run test:e2e` locally — the checked-in build/test logs from earlier runs have been removed from the repo (see writeup.md's hygiene note).

---

## Known limitations

Named on purpose, not hidden — see **[writeup.md § Known limitations](./writeup.md#known-limitations)** for the full list and what I'd do next for each:

1. Live SSE feed is idle on the current free-tier deploy (writer auth not configured on that deployment).
2. Country-label resolution (topojson point-in-polygon, for the sidebar's "China / USA / …" grouping) and the faker generator's `regionHint` (used for plates/vehicle models) are two independent classifiers that can disagree at the margins — a bin can display under one country while its vehicle plates were generated for another.
3. Global support (multi-country data) was a stretch addition, not the brief — it's real (per-region plate formats, per-region vehicle models, actual topojson country resolution), but it hasn't had the same design-review pass as the India-first core experience.
4. SSE fan-out is N-viewers-N-reads (named in `/api/stream`), fine for a demo, not fine past a handful of concurrent viewers — production would move this to managed pub/sub.