# Writeup: Fleet Console

This is the long-form version of the README — what I built, why, the trade-offs I made under a ~1-day budget, and an honest list of what I'd flag to a reviewer myself before they find it.

## Contents

- [The brief, as I understood it](#the-brief-as-i-understood-it)
- [What changed from the reference](#what-changed-from-the-reference)
- [Architecture](#architecture)
  - [Rendering split: RSC shell / client islands](#rendering-split-rsc-shell--client-islands)
  - [The D3/React boundary](#the-d3react-boundary)
  - [State: Zustand](#state-zustand)
  - [Data model: Upstash Redis](#data-model-upstash-redis)
  - [Realtime: reader/writer split over SSE](#realtime-readerwriter-split-over-sse)
  - [Zoom tiers and re-binning](#zoom-tiers-and-re-binning)
  - [Color encoding](#color-encoding)
  - [Global data generation](#global-data-generation)
- [Accessibility](#accessibility)
- [Testing](#testing)
- [Why Redis/QStash for a take-home — the honest answer](#why-redisqstash-for-a-take-home--the-honest-answer)
- [Known limitations](#known-limitations)
- [What I'd do with another day](#what-id-do-with-another-day)

---

## The brief, as I understood it

A map-based battery analytics client for Coulomb AI (real-time battery observability for EV fleets — manufacturers, OEMs, fleet operators). I was shown a reference screenshot (single-hue purple fill, India-only, "Fleet Console" chrome) and told: implement it in a scalable way using D3 since it's client-facing, a senior UX/Frontend lead will review it technically, I'm free to improve on the reference, and global support is planned eventually. So the actual deliverable is not "reproduce the screenshot" — it's "show you understand how to build this kind of thing correctly at scale," with the screenshot as a floor, not a ceiling.

## What changed from the reference

| Reference | This implementation | Why |
| --- | --- | --- |
| Single purple hue, opacity implied by overlap | Dual-channel: hue = health, opacity = density | A single hue can't separate "unhealthy but sparse" from "healthy but dense" — you need two visual channels for two independent variables. |
| India only | World map, country/zone drill-down | Told this was planned eventually; the projection + topojson approach made it close to free to add now rather than retrofit later. |
| (not shown as live) | SSE-driven live diffs, D3-owned transitions | "Real-time" is in the product's own name (Battery *Observability* Platform) — a static snapshot undersells the actual use case. |
| Mouse-only implied | Full keyboard nav + roving tabindex + reduced-motion support | Table stakes for a client-facing dashboard, not really optional at this point. |

## Architecture

### Rendering split: RSC shell / client islands

`app/layout.tsx` and `app/page.tsx` are a server component with no data dependency — they paint the layout grid (nav, topbar, map/sidebar frame) immediately. `FleetMap` and `Sidebar` are client components that hydrate afterward. This buys first paint; it does **not** buy SSR for the map itself, because the map is inherently client-side (D3 manipulating the DOM directly, SSE connections, etc.) — I'm not pretending otherwise.

### The D3/React boundary

This is the single most important architectural decision in the repo, so it gets the most explanation.

**The problem it solves:** the naive way to put D3 inside React is to let a data prop drive a `useEffect` that re-runs the D3 join on every change. That works fine for static charts. It falls over the moment the data updates on a timer (SSE, polling) — every tick becomes a full React re-render of a component tree sitting on top of ~90+ SVG paths, plus whatever the join itself costs. At 25,000 vehicles rolled up into ~90 hex bins, refreshing every few seconds, that's a lot of unnecessary reconciliation for changes that are, most of the time, a handful of bins nudging their fill color.

**The fix:** `HexLayer.tsx` splits "structural" changes from "value" changes and gives them different code paths:

- **Structural changes** — projection changes, zoom-tier changes (radius), the visible bin set changing (region filter) — go through a normal `useEffect` that does the full D3 enter/update/exit join, keyed on a stable identity (`d.bins.map(b => b.id).sort().join('|')`, not array index) so the DOM node for a given set of bins survives across re-renders.
- **Value changes** — an SSE diff landing — go through a *second*, separate `useEffect` that does nothing but `useFleetStore.subscribe(...)` **outside React's render cycle**. When `diffVersion` changes, it walks the *existing* `<path>` elements, recomputes each one's aggregate from the (in-place-mutated) source data, and drives a D3 `.transition()` on `fill`/`fill-opacity` directly. No React state is written, so no React re-render is triggered, so nothing downstream re-renders either.

The store cooperates with this on purpose: `bins` in `fleetStore.ts` is a **mutable array that React does not treat as immutable state** for this purpose. `applyDiff` finds bins by id and mutates their fields in place, then bumps a `diffVersion` counter. Nothing in the app selects `diffVersion` as React state except `HexLayer`'s manual subscription — every other consumer of the store (topbar counts, sidebar) reads through normal Zustand selectors and re-renders normally, because those *should* re-render (they're small, and correctness there matters more than avoiding a render). The hex layer is the one place where render cost is genuinely a concern, so it's the one place that opts out of React's default behavior.

Net effect: panning/zooming within a tier is a pure SVG transform (zero JS recompute), a live diff recolors N hexes without touching the React tree at all, and a full re-bin only happens when it structurally has to (tier crossed, filter changed, projection changed).

### State: Zustand

`store/fleetStore.ts` holds: bins (mutable, see above), region rollups, selection/hover state, view mode, zoom tier, and filters. Filters are mirrored to the URL via `store/useUrlSync.ts` (both directions — a deep link wins on mount, and filtering doesn't pollute browser history since it uses `router.replace`). This was a deliberate differentiator over the reference: a fleet ops person filtering to one region and sharing that link with a teammate is a real workflow, and it was cheap to support properly.

### Data model: Upstash Redis

```
fleet:meta                    Hash    { total_vehicles, last_updated }
fleet:bin:{id}                Hash    { lat, lng, vehicle_count, avg_soh, avg_soc, open_exceptions, region, ... }
fleet:bins:index              Set     all bin IDs
fleet:vehicles:{bin_id}       List    capped at 50 vehicles, sorted ascending by SOC
fleet:region:{name}           Hash    region rollup { vehicle_count, alerts_per_1k, share_of_fleet }
fleet:trend:{region}          ZSet    24h of hourly avg-SOC readings (score = unix timestamp)
fleet:diff:latest             String  JSON of the most recent writer diff
fleet:writer:lock             String  distributed lock (short TTL) preventing concurrent writes
fleet:seed:version            String  version tag; absence means seed is incomplete
```

The read path is deliberately shaped around **bin-level aggregates, not per-vehicle data**, because that's what the map actually renders: `/api/bins` does three pipelined reads over ~90 bin hashes — never touches the 25,000 individual vehicle records. Vehicle-level detail (`fleet:vehicles:{bin_id}`) is only read by `/api/bin/[id]`, lazily, when a user actually drills into one bin, and it's capped at 50 entries per bin so a dense bin can't blow up the payload. This is the same "aggregate for the overview, paginate/lazy-load the detail" pattern you'd want for any dashboard at this scale, not something specific to Redis.

### Realtime: reader/writer split over SSE

`/api/writer` (POST) is the **only** route that mutates Redis. It takes a short-TTL lock, mutates 3–5 bins, updates rollups, writes the diff document, releases the lock. `/api/stream` (GET) is a **pure reader** — it sends a full snapshot on connect (so a client that missed diffs while disconnected doesn't trust stale in-memory state) and then polls `fleet:diff:latest` every 5 seconds, pushing only when it actually changed.

The reason this is split at all: if the SSE route itself mutated data on each tick, every open browser tab would be an independent writer — two tabs open means 2× the write rate, uncoordinated, and it gets worse from there. Splitting reader from writer means N viewers is N reads, not N writes; the actual write cadence is controlled by whatever invokes `/api/writer` (QStash cron in production).

I also considered WebSockets and rejected them explicitly: this is a read-only dashboard with no client→server push, so a duplex transport is complexity the requirement doesn't ask for, and `EventSource` gives reconnect-with-backoff for free. Documented as a decision in the code, not an oversight.

### Zoom tiers and re-binning

`lib/hexbin.ts` defines three discrete zoom tiers (radius 22/13/7px, with rising label thresholds as hexes get smaller). Re-binning only happens when a zoom crosses a tier boundary (`crossesTier`), not on every zoom frame — panning/zooming *within* a tier is a pure SVG transform. Since the actual input to `binHexes()` is the ~90 pre-aggregated bin summaries (not 25k raw points), the binning itself is cheap regardless of tier; the tiering machinery mainly exists to keep hex size/label density sane across zoom levels, and it composes with the D3-owns-the-subtree design above rather than fighting it.

### Color encoding

`lib/colourScale.ts`:

- **Fill hue** encodes fleet health, from average SOC through a red → amber → green interpolated ramp (`healthColour`), chosen to be colorblind-safer than a single-hue purple scale, which loses discriminability across its range.
- **Fill opacity** encodes density, linearly scaled from vehicle count within `[OPACITY_MIN, OPACITY_MAX]` so sparse bins stay visible (floor) and dense/overlapping hexes at borders stay legible (ceiling < 1).
- Three view modes — Combined / Health only / Density only — isolate each channel, mostly so a reviewer (or a real user) can verify the encoding is doing what it claims rather than trusting a blended color.

### Global data generation

`lib/faker/seed.ts` generates a deterministic (`faker.seed(42)`) synthetic fleet across seven region buckets (india/china/usa/europe/sea/me/world), each with its own weighted lat/lng bounding box, its own vehicle-model pool, and its own license-plate format (`plateFor`) — e.g. Chinese-character-prefixed plates for the China bucket, 3-letter/4-digit for the US bucket, and so on.

**This is also where the one real data-consistency bug in the repo lives**, and I want to be upfront about it rather than let a reviewer find it first: the *generator's* region bucket (`regionHint`, used for plates/model pools) and the *display layer's* country label (`lib/geo/resolveCountry.ts`, real point-in-polygon lookup against `world-countries.topo.json`) are two independent classifications of the same bin. They usually agree, but a bin can be sampled into, say, `regionHint: 'world'` (which defaults to an India-style plate format) while its actual lat/lng resolves inside China's real borders — so the sidebar groups it under "China" while its vehicles show default-format plates. Root cause and fix are both simple: derive `regionHint` from the same `resolveCountry()` call the sidebar already uses (or generate plates after geo-resolution instead of from the sampling loop), so there's exactly one source of truth for "what country is this bin in." Not done yet — listed in [Known limitations](#known-limitations).

## Accessibility

- **Roving tabindex** on the hex layer: exactly one hex is a tab stop at a time; arrow keys move focus geometrically (`nearestInDirection` scores candidates by directional distance, penalizing perpendicular drift, since a hex grid isn't a regular grid — "the next element to the right" is a geometry problem, not an array-index one).
- **Enter/Space** select a hex (matches `role="button"` semantics); **Escape** clears selection.
- **`prefers-reduced-motion`** is checked before every D3 transition (hover highlight, SSE recolor); when set, the same visual end-state is applied instantly via `.interrupt().attr(...)` instead of `.transition()`.
- Native `<title>` elements as a tooltip fallback, plus a richer custom tooltip component for pointer users.
- `aria-label`s on the map region and hex group; live-region copy for connection status ("Live feed connected" / "Live feed paused · Reconnecting…") so screen-reader users get the same signal sighted users get from the pulse indicator.

## Testing

- **Vitest unit tests:** color-scale math (`colourScale.test.ts`), seed determinism + idempotency (`seed.test.ts`), the HexLayer SSE→D3-transition contract specifically (`hexLayer.test.tsx` — asserts no React re-render occurs on a diff, that the DOM updates anyway, and that the transition fires), sidebar drill-down behavior (`sidebar.test.tsx`), and bidirectional URL/filter sync (`urlSync.test.tsx`).
- **Playwright e2e:** a single but real end-to-end path — load, filter to a region, click a hex, drill into a bin, see its vehicle list — run against mocked `/api/bins`, `/api/bin/:id`, `/api/stream` so it doesn't depend on a live Redis instance.
- `tsc --noEmit` is clean; `next build` compiles (first-load JS ≈ 132 kB shared).

## Why Redis/QStash for a take-home — the honest answer

I built more backend than a pure-frontend take-home strictly requires, and I'd rather own that directly than have a reviewer wonder about it silently.

The reason isn't "I wanted to use Redis" — it's that the D3/React boundary described above only matters, and only proves anything, if there's a real asynchronous data source pushing changes on its own schedule. A mocked `setInterval` in a component would have exercised the same code path but proven nothing about whether the design holds up against a real read/write-separated backend, connection drops, out-of-order diffs, or a reconnect that needs a snapshot. So the backend exists to make the frontend claim (*"D3 owns the subtree, React doesn't re-render on live ticks"*) a tested fact instead of an assertion in a comment.

That said — the specific choice of Redis+QStash is incidental, not load-bearing. The thing that matters is the shape (pre-aggregated read model, single writer, many readers, snapshot-then-diff over SSE), not the vendor. If the ask was narrower than that, the honest trim is: keep the D3/React boundary and the SSE contract, swap Redis for an in-memory store and QStash for a plain `setInterval` calling the writer function directly, and the frontend code doesn't change at all.

## Known limitations

Named on purpose — these are the things I'd rather tell a reviewer than have them find:

1. **Live SSE feed is idle on the deployed demo.** `/api/stream`'s connect-time kick calls `/api/writer` with `x-writer-secret`, but the deployed Vercel project doesn't have `WRITER_SECRET` (or QStash) configured, so the kick 404s/401s silently and the feed sits at "Live · 0 bin updates received." The wiring is real and works locally with the env var set — this is a deployment-config gap, not a design gap, and 2 minutes of Vercel dashboard work fixes it.
2. **`regionHint` vs. `resolveCountry()` disagreement** (detailed above under [Global data generation](#global-data-generation)) — a bin's generated plate/model region can disagree with its geo-resolved country label at the margins. Doesn't affect the India-first core experience (where it was validated most carefully); shows up in the global/multi-country view, which was the stretch addition.
3. **SSE fan-out is N-viewers-N-Redis-reads** (named directly in `/api/stream`'s comments) — fine for a demo or a handful of concurrent viewers, not a real production fan-out strategy. Production would move this to managed pub/sub (Ably/Pusher/PartyKit) or a persistent WS process.
4. **Currency is resolved by viewer locale/IP, not per-bin/per-country** — this is intentional (a per-bin currency switch while panning a world map would be more confusing than clarifying for an ops dashboard), not an oversight, but worth stating explicitly since it could otherwise look like a missed detail.
5. Earlier local build/test/tsc log files were committed into the repo root at one point during development; removed as part of this cleanup pass.

## What I'd do with another day

- Fix the `regionHint`/`resolveCountry()` seam (§ above) — single source of truth for "what country is this bin in."
- Wire `WRITER_SECRET` on the deployment so the live demo actually demos live.
- Move SSE fan-out off per-connection Redis polling once there's more than a couple of concurrent viewers to support.
- Add a visual regression test on the hex fill/opacity output (the unit tests cover the math and the transition contract, not a rendered screenshot).
- Get the global dataset a real design pass instead of a "structurally correct, not yet reviewed" one.
