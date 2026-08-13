# mapcai
# Fleet Console

A Next.js 14 Fleet Console for 25,000 deterministic EVs across Indian fleet hubs.

## Run locally

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and add the Upstash Redis values.
3. `npm run seed`
4. `npm run dev`

The app opens at `http://localhost:3000`. Seeding is idempotent; use `npm run seed -- --force` to recreate the dataset.

## Architecture

- The server-rendered shell paints immediately; the India map is a client-side D3 SVG.
- Hex fill hue encodes health (`avg SOH × (1 − exception rate)`); opacity encodes density. The legend isolates either channel.
- Zustand holds selection and filters. D3 owns the hex DOM and applies SSE diffs without React reconciliation or re-binning.
- `/api/bins` reads bin summaries. `/api/bin/:id` lazily reads one bin's capped, SOC-ascending vehicles and 24-hour regional trend.
- `/api/writer` is the only mutation route. It uses QStash or `WRITER_SECRET`, a Redis lock, and a short-lived diff document. `/api/stream` is a pure SSE reader.

## Realtime setup

Configure a QStash schedule to POST to `/api/writer` with the signing keys in the environment. The free tier's minimum schedule interval is 60 seconds; the SSE reader polls the diff every 5 seconds. Pay-as-you-go supports a 1-second minimum.

## Checks

- `npm run test` runs Vitest unit/component tests.
- `npm run test:e2e` runs Playwright against a local Next server and mocks Redis-backed routes for a deterministic UX flow.
- `npx tsc --noEmit` and `npm run build` verify the production bundle.

## Explicit production boundaries

Serverless SSE creates one long-lived invocation and Redis poll per viewer. At larger concurrency, move fan-out to a persistent WebSocket process or managed pub/sub. Upstash REST cannot hold a persistent Redis `SUBSCRIBE`; Kafka belongs in a separate ingestion path. The 24-hour SortedSet is a sparkline cache, not an analytics store; move cross-dimension analytics to Timescale or ClickHouse when needed. Bin IDs are seeded placeholders; H3 indexing belongs in ingestion.
