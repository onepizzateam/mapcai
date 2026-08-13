# Fleet Console — Implementation Plan
**Take-home assignment · Senior Frontend/UX lens**  
*v4 — final; all known bugs addressed, production gaps named explicitly, scope hard-bounded*

---

## 0. What the reference gets right, and where we improve

The Coulomb AI Fleet Console is clean and functional. Three gaps worth closing — each one demonstrates senior judgment, not just feature additions:

| Gap | Why it matters |
|---|---|
| No time axis | "91% avg SOH" is meaningless without trend — climbing or falling? |
| Colour conflates density and health | A bin with 2,000 vehicles at 5% SOC looks identical to 2,000 healthy ones |
| No triage order | Most critical vehicles are buried in a flat list |

---

## 1. Technical decisions

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 14 App Router** | RSC shell for static layout; client components for D3/Zustand. SSR buys the initial HTML paint — map is inherently client-rendered, so don't oversell RSC in the pitch. |
| Map / Viz | **D3 v7** (`d3-hexbin`, `d3-geo`, `d3-scale`, `d3-zoom`) | Full control over hexbin radius, projection, dual-channel colour encoding, transition timing. No tile provider, no API key. |
| Data store | **Upstash Redis** (Vercel Marketplace) via `@upstash/redis` | Vercel KV was sunset/migrated to Upstash in Dec 2024 — new projects provision Redis through Upstash's Marketplace integration. Naming "Vercel KV" in 2026 is a red flag to a senior reviewer. |
| Realtime writer | **Upstash QStash** scheduled job → `POST /api/writer` | Minimum schedule interval is **60 seconds** on QStash's free tier, **1 second** on Pay-as-you-go. For demo purposes, 10s poll in the SSE reader fills the gap. |
| Realtime reader | **Server-Sent Events** from `/api/stream` (Node runtime) | SSE is correct — this is a read-only dashboard, no client→server push. WebSockets would be complexity with no matching requirement. |
| Styling | **Tailwind CSS v3** + CSS custom properties | Utility classes for layout; CSS vars for the design-token system (theme is one file, easy to swap). |
| State | **Zustand** | Selected bin, filters (mirrored to URL), streamed diffs. No Redux ceremony. |
| Data gen | **`@faker-js/faker`** with `faker.seed(42)` | Deterministic — reproducible across reviewers. One-time CLI script, not invoked on deploy. |
| Fonts | **Inter Variable** (UI) + **DM Mono** (numbers/IDs) | Inter is legible at 11px; DM Mono gives plate numbers and SOC values a tabular, unambiguous read. |
| Testing | **Vitest** (unit) + **Playwright** (E2E) | 5–6 targeted tests signals production instincts without needing full coverage. |

### Why D3 directly (not Deck.gl)

Deck.gl's `HexagonLayer` is GPU-accelerated but opinionated — custom tooltip, click handling, and dual-channel colour logic all fight its API. At ~90 hexbins, plain SVG + D3 is fast enough; GPU acceleration solves a problem we don't have at this scale. Worth naming explicitly in the interview — reaching for Deck.gl here is the kind of over-engineering that signals less experience, not more.

### Colour encoding — the core visual improvement

Two channels, not one:

- **Fill hue** → fleet health index `(avg_SOH × (1 − exception_rate))` on a diverging scale
- **Fill opacity** → vehicle count (density)

Result: dense + unhealthy = solid red; sparse + healthy = faint blue. Density no longer masks health.

**Colourblind-safe palette:** the purple-only scale in the reference fails for ~8% of men (red/green confusion is irrelevant here, but the single-hue scale loses perceptual resolution across the range). Use **red → amber → blue** instead — maximum discriminability, colourblind-safe. The legend + view-mode toggle (`Combined / Health only / Density only`) is a single Zustand flag and three fill-function branches — cheap to build and the most visible differentiator over the reference, which has no legend at all.

---

## 2. Data model (Upstash Redis)

```
fleet:meta                        → Hash       { total_vehicles, last_updated }
fleet:bin:{bin_id}                → Hash       { lat, lng, vehicle_count, avg_soh, open_exceptions, region }
fleet:bin:{bin_id}:vehicles       → List       [ vehicle_id, ... ]  (trimmed to 50, sorted by SOC asc on write)
fleet:vehicle:{id}                → Hash       { id, model, soc, status, soh, bin, lat, lng }
fleet:region:{name}:summary       → Hash       { vehicle_count, alerts_per_1k, share_pct }
fleet:region:{name}:trend         → SortedSet  (score = hour-epoch, member = avg_soh)  — 24h ring via ZREMRANGEBYSCORE
fleet:alerts:recent               → SortedSet  (score = timestamp, member = alert_json)
fleet:writer:lock                 → String      TTL 6s — distributed lock, one writer at a time
```

All bin summaries are read in a single pipelined `MGET` — O(n_bins), not O(n_vehicles). Vehicle lists and trend data are fetched lazily on bin select.

**On the trend SortedSet:** this is a 24h cache, not an analytics system. It supports exactly one query. No downsampling strategy, no arbitrary time ranges, no cross-dimension aggregation (SOH by vehicle model, by exception type, etc.). Redis is the right store for "last 24h, fast read" — and the wrong store for anything beyond that. When the product needs cross-dimension analytics, this slot wires to Timescale or ClickHouse behind `/api/trend`; the SortedSet gets retired. Saying this unprompted in the interview is worth more than staying silent.

### Seeder (`scripts/seed.ts`)

- 25,000 vehicles across ~90 hex bins, clustered around real EV hotspots (Delhi NCR, Mumbai, Bangalore, Hyderabad, Chennai, Pune, Surat, Ahmedabad)
- SOH: beta distribution, most vehicles 85–98%, long tail below 70%
- SOC: uniform `[5%, 100%]`; Status: 65% Driving / 25% Charging / 10% Parked
- Open exceptions: Poisson(λ=8) per 1,000 vehicles
- Trend backfill: 24 synthetic hourly points per region so the sparkline is populated on first load
- Idempotent, version-tagged; `--force` clears and re-seeds

`/api/seed` is a `POST` route gated by `process.env.NODE_ENV !== 'production'` **and** a shared-secret header (`x-seed-secret`). Never reachable from a deployed preview by accident.

---

## 3. Architecture

```
app/
├── layout.tsx
├── page.tsx                        # RSC shell — static chrome, no data
│
├── components/
│   ├── map/
│   │   ├── FleetMap.tsx            # D3 SVG map, zoom, pan (client component)
│   │   ├── HexLayer.tsx            # Hexbins, click → store
│   │   ├── HexLegend.tsx           # Colour scale legend + view-mode toggle
│   │   ├── HexTooltip.tsx          # Hover/focus tooltip
│   │   ├── MapControls.tsx         # Zoom buttons, region filter pills
│   │   └── useIndiaGeo.ts          # Fetches TopoJSON once, memoises projection
│   │
│   ├── sidebar/
│   │   ├── Sidebar.tsx             # Region summary ↔ bin detail (conditional render)
│   │   ├── RegionSummary.tsx
│   │   ├── TrendSparkline.tsx      # 24h avg-SOH trend (D3 line, no library)
│   │   ├── BinDetail.tsx
│   │   ├── VehicleList.tsx         # react-window FixedSizeList, SOC-sorted ascending
│   │   └── VehicleCard.tsx
│   │
│   ├── ui/
│   │   ├── SOCBar.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── LivePulse.tsx           # Animated dot, aria-live region
│   │   └── MetricRow.tsx
│   │
│   └── shell/
│       ├── Topbar.tsx
│       └── Nav.tsx
│
├── store/
│   └── fleetStore.ts               # Zustand + URL-sync middleware
│
├── app/api/
│   ├── bins/route.ts               # GET /api/bins          → all bin summaries (5s revalidate)
│   ├── bin/[id]/route.ts           # GET /api/bin/:id       → detail + vehicles + trend
│   ├── stream/route.ts             # GET /api/stream        → SSE reader (Node runtime, pure reader)
│   ├── writer/route.ts             # POST /api/writer       → QStash webhook target (single mutation source)
│   └── seed/route.ts               # POST /api/seed         → non-prod only
│
├── lib/
│   ├── redis.ts                    # Upstash client + typed helpers
│   ├── projection.ts               # D3 Mercator, parameterised bounds
│   ├── hexbin.ts                   # Discrete zoom-tier radius + re-bin logic
│   ├── colourScale.ts              # Dual encoding, colourblind-safe
│   └── faker/seed.ts
│
└── scripts/
    └── seed.ts                     # npx tsx scripts/seed.ts
```

### Component interaction diagram

```
RSC page.tsx
  └── FleetMap (client)
        ├── useIndiaGeo         → fetches /public/india-states.topo.json (once)
        ├── HexLayer            → reads fleetStore.bins, calls D3 directly (no React reconcile on update)
        ├── HexTooltip          → reads fleetStore.hoveredBin
        ├── HexLegend           → reads fleetStore.viewMode, writes fleetStore.viewMode
        └── MapControls         → writes fleetStore.zoomTier, fleetStore.regionFilter

  └── Sidebar (client)
        ├── RegionSummary       → reads fleetStore.regions (from /api/bins)
        ├── TrendSparkline      → fetches /api/bin/:id lazily on bin select
        ├── BinDetail           → reads fleetStore.selectedBin
        └── VehicleList         → react-window, reads fleetStore.selectedBin.vehicles

  └── useSSEStream (hook, client)
        → GET /api/stream
        → fleetStore.applyDiff(diff)  →  D3 transition (ref callback, not React state)
```

---

## 4. Map implementation

### Projection

```typescript
const projection = d3.geoMercator()
  .fitSize([width, height], indiaGeoJSON)
  .precision(0.1);
```

TopoJSON of India states (~200KB, Datameet open licence) at `/public/india-states.topo.json`. Fetched once on mount, stored in a module-level ref — no re-fetch on re-render.

### Hexbin — discrete zoom tiers, not continuous recompute

Recalculating hexbin radius on every `zoom` event means re-binning up to 25k points per frame — real jank. Instead:

```typescript
const ZOOM_BREAKPOINTS = [
  { maxZoom: 1.5,  radius: 28, labelThreshold: Infinity }, // overview
  { maxZoom: 3.0,  radius: 18, labelThreshold: 500 },      // region
  { maxZoom: Infinity, radius: 10, labelThreshold: 100 },  // city
] as const;

// Re-bins ONLY at breakpoint crossings, debounced 120ms
const hexbin = useMemo(() =>
  d3.hexbin<BinDatum>()
    .x(d => projection([d.lng, d.lat])![0])
    .y(d => projection([d.lng, d.lat])![1])
    .radius(currentTier.radius),
  [binData, currentTier]  // currentTier changes at breakpoints, not per-frame
);
```

Pan/zoom *within* a tier is a pure SVG `transform` on `<g class="map-layer">` — zero JS, zero recompute. Crossing a breakpoint re-bins once, debounced, cross-fades old→new hexagons. State labels reveal at tier 2+.

`d3-zoom` handles touch pinch/pan natively — no separate mobile gesture library needed.

### Animation on SSE update

D3 owns the SVG DOM. React renders the shell once and passes data via refs/callbacks. **No React reconciliation on SSE ticks** — this is the single biggest performance lever in the plan.

```typescript
hexagons.transition()
  .duration(800)
  .ease(d3.easeCubicOut)
  .attr('fill', d => colourScale(d.healthIndex))
  .attr('fill-opacity', d => densityScale(d.vehicleCount));

// prefers-reduced-motion: skip transition entirely
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  hexagons.interrupt()
    .attr('fill', d => colourScale(d.healthIndex))
    .attr('fill-opacity', d => densityScale(d.vehicleCount));
}
```

---

## 5. Real-time data flow — writer/reader split

This is the most important architectural decision in the plan, and the place the naive implementation is broken at 2 concurrent users, not just at scale.

### The bug in the obvious approach

Putting the mutation loop inside the SSE route handler means every connected client runs its own independent writer. Two tabs open = two mutation loops writing to Redis at 2× the intended rate with no coordination. This is broken, not just "not scalable."

### The fix: strict writer/reader separation

```
Upstash QStash (scheduled job, every ~30s)
  │
  └─→ POST /api/writer
        ├── acquire fleet:writer:lock (Redis SET NX EX 6)
        ├── mutate 3–5 bins (SOC drift, status flips, exception changes)
        ├── write diff to fleet:latest:diff (SET, 30s TTL)
        └── release lock

Upstash Redis
  └─→ GET /api/stream (SSE, Node runtime, pure reader)
        ├── on connect: send full bin snapshot from /api/bins
        ├── poll fleet:latest:diff every 5s
        ├── push diff as SSE event if changed (ETag comparison)
        ├── heartbeat comment ": ping\n\n" every 15s (keeps proxies/LBs alive)
        └── client EventSource auto-reconnects (exponential backoff, built-in)

Client: useSSEStream hook
  └─→ fleetStore.applyDiff(diff)
        └─→ D3 transition (ref callback, not React setState)
```

- **`/api/writer`** — receives QStash webhook, acquires distributed lock, mutates, releases. **No mutation logic anywhere else in the codebase.**
- **`/api/stream`** — pure reader. Never writes. Node runtime (not Edge) because SSE requires a persistent connection that Edge functions can't hold.
- **Distributed lock** — prevents double-write if QStash retries an invocation on slow response.

### QStash schedule note

QStash's minimum schedule interval is **60 seconds on the free tier**. For a demo where reviewers expect to see live updates within seconds, bridge the gap: the SSE reader polls `fleet:latest:diff` every 5 seconds client-side. QStash fires the writer every 60s; the SSE reader catches the diff within 5s of it landing. No extra cost, no polling theatrics. On Pay-as-you-go, the minimum drops to 1 second — name this in the README so the reviewer knows you checked.

### The serverless fan-out ceiling (named, not solved here)

Each open SSE connection is a live serverless function invocation. 500 concurrent viewers = 500 concurrently-billed long-running invocations competing for the plan's concurrency ceiling, plus redundant Redis reads for identical data.

This is fine at take-home scale (you + one reviewer). It is not the production answer.

**Production fix (not built here, named explicitly):** move real-time fan-out off serverless — a small persistent Node/WS process (Fly.io, Railway) subscribed to Redis pub/sub, broadcasting to N socket connections from one process. Or: a managed pub/sub service (Ably, Pusher, PartyKit) so Vercel functions stay stateless. Either is the standard answer; "SSE from a serverless function" is the demo shortcut, and saying so explicitly is more senior than staying silent.

**The Kafka swap is not a one-line change.** "Swap in Kafka later" sounds like a drop-in, but Upstash's REST client can't hold a persistent `SUBSCRIBE` TCP connection. A real Kafka consumer requires the persistent-process architecture above. Kafka belongs in the *ingestion* path at real telemetry volume (vehicle → broker → processor → Redis); it doesn't solve the fan-out problem and shouldn't be implied to.

---

## 6. UX details worth calling out in the interview

These are the decisions that read as senior UX judgment, not just feature additions:

| Decision | Why it signals seniority |
|---|---|
| **Filters sync to URL** (`?region=north&status=driving`) | Shareable, bookmarkable state. Cheap with `useSearchParams` + Zustand URL middleware. The reference doesn't do this, but any ops team would immediately ask for it. |
| **Vehicle list sorted by SOC ascending** | Most critical vehicles surface first. No sort order in the reference — ours is an opinionated, defensible product decision. |
| **Legend + view-mode toggle** | Ships as three fill-function branches behind one Zustand flag. Without it, the dual-channel encoding is unexplained and potentially confusing. |
| **Keyboard navigation** | Roving `tabindex`, arrow keys move focus between adjacent hexes, `Enter` selects. Zero extra libraries — pure DOM attribute management. |
| **Colourblind-safe palette** | The reference's purple-only scale loses perceptual resolution. Red → amber → blue maximises discriminability and passes WCAG AA contrast requirements at both fill levels. |
| **Mobile bottom sheet** | Sidebar collapses to a drag-handle sheet snapping at 20%/60%/90% viewport height. Map is full-bleed underneath. Implemented with CSS `transform` + `touch-action: none` — no library. |
| **ARIA live region on SSE update** | `aria-live="polite"` on the live pulse counter announces update count to screen readers without interrupting. |

### UX copy decisions

The reference uses label copy like "Open exceptions 21 · 11.2/1k" — serviceable but not optimised for fast scanning. Our sidebar:

- **Drives action, not just data:** "21 open · 11.2 per 1k vehicles" → triage instinct rather than raw stat
- **Status badges use sentence-case verbs:** "Driving", "Charging", "Parked" — not all-caps, not icons-only
- **Empty states direct action:** "Select a region to see vehicle breakdown" not a spinner or blank
- **Error messages say what to do:** "Live feed paused · Reconnecting…" with a retry link, not "SSE error"

---

## 7. Design system

### Colour tokens

```css
:root {
  --color-bg:           #F8F8FC;
  --color-surface:      #FFFFFF;
  --color-border:       #E4E4EF;
  --color-border-strong:#C4C4DF;
  --color-text-primary: #111128;
  --color-text-muted:   #6B6B8A;
  --color-accent:       #5B5BD6;

  /* Health scale — colourblind-safe red → amber → blue */
  --color-health-low:   #EF4444;   /* unhealthy */
  --color-health-mid:   #F59E0B;   /* marginal  */
  --color-health-high:  #3B82F6;   /* healthy   */

  /* Status */
  --color-driving:      #22C55E;
  --color-charging:     #3B82F6;
  --color-parked:       #9CA3AF;

  /* SOC severity */
  --color-soc-critical: #EF4444;   /* < 20% */
  --color-soc-low:      #F59E0B;   /* 20–50% */
  --color-soc-ok:       #22C55E;   /* > 50% */
}
```

### Typography

- **Inter Variable** — all UI text, labels, sidebar numbers. `font-feature-settings: "ss01"` for disambiguated `0/O`.
- **DM Mono** — vehicle IDs, coordinates, raw telemetry; `font-variant-numeric: tabular-nums`, no ligatures.

### Spacing

4px base grid. Component-level spacing: `4 / 8 / 12 / 16 / 24 / 32px`. No arbitrary values in Tailwind.

---

## 8. Performance budget

| Metric | Target | Mechanism |
|---|---|---|
| LCP | < 1.5s | RSC shell paints immediately; TopoJSON pre-gzipped (~40KB) |
| Hexbin render | < 16ms (60fps) | D3 owns SVG; re-bin only at zoom-tier breakpoints; no React reconcile on data tick |
| SSE round-trip | < 200ms | Node runtime; diffs only, not full bin state; ETag deduplication |
| Virtualised list scroll | 60fps | `react-window` `FixedSizeList`, pure `VehicleCard` (no internal state) |
| Redis reads | < 10ms | Pipelined `MGET`; Upstash edge replica co-located with Vercel function region |
| Initial JS bundle | < 120KB gzipped | D3 tree-shaken (import only used submodules); no Deck.gl overhead |

---

## 9. Known limitations — named explicitly, not buried

| Item | What's missing | Correct production path | Why deferred |
|---|---|---|---|
| SSE fan-out | N viewers = N× Redis reads; no broadcast | Persistent WS process (Fly.io) or managed pub/sub (Ably/Pusher) | Out of scope for demo scale |
| Redis SUBSCRIBE | Upstash REST can't hold a persistent TCP SUBSCRIBE | Persistent-process architecture above | Implied in "Kafka swap" language — explicitly debunked here |
| Kafka ingestion | QStash writer is a fake mutator, not a real telemetry consumer | Kafka → consumer process → Redis → SSE fan-out | Correct for ingestion path at volume; separate from fan-out |
| Analytics | SortedSet supports one query; no retention policy or cross-dimension aggregation | Timescale / ClickHouse behind `/api/trend` | Correct for 24h sparkline; named as the boundary |
| H3 indexing | Bin IDs are fake; real H3 requires per-event cell computation in ingestion path | Schema is keyed by `bin_id` — migration is bounded | Seeds the right schema shape for later |
| QStash free tier | Minimum 60s schedule interval on free tier | Pay-as-you-go for 1s minimum; bridge with 5s SSE poll | Noted in README explicitly |

---

## 10. What's actually solid — don't over-correct

- **D3 owning the SVG DOM** — no React reconciliation on data update. Legitimately good, holds up at real scale.
- **Pipelined `MGET` for bin summaries** — O(n_bins), not O(n_vehicles). Correct shape.
- **Stateless `/api/bins` and `/api/bin/[id]`** — exactly what serverless is good at.
- **SSE as one-directional transport** — right call for a read-only dashboard.
- **Discrete zoom-tier re-binning** — solves the render-perf problem without continuous recompute.
- **Zustand + URL sync** — lightweight, testable, bookmarkable. No over-engineered state machine.

---

## 11. Delivery checklist

- [ ] `scripts/seed.ts` — `npx tsx scripts/seed.ts` populates Upstash Redis
- [ ] `public/india-states.topo.json` — Datameet open licence, committed to repo
- [ ] `.env.local.example` — `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_TOKEN`, `WRITER_SECRET`, `SEED_SECRET`
- [ ] `README.md` — 3 commands: `pnpm i && npx tsx scripts/seed.ts && pnpm dev`; QStash free-tier interval note
- [ ] 5–6 Vitest tests: colour scale math, bin-select → sidebar render, filter → URL sync, SSE diff → D3 transition, seed idempotency
- [ ] 1–2 Playwright E2E: full flow (load → click bin → sidebar populates → live update visible)
- [ ] Vercel preview URL (not main branch — use a `feature/take-home` branch deploy)
- [ ] 60–90s Loom: narrate the three improvements (legend, sparkline, SOC-sorted list), show the live update, show mobile

---

## 12. Implementation phases (4-day plan)

### Phase 1 — skeleton + static map (Day 1, ~4h)
Next.js 14 project, Tailwind, Zustand, Inter + DM Mono. TopoJSON India render. D3 Mercator projection. Static hexbin layer with hardcoded bins — discrete zoom tiers working. Topbar + icon nav shell. Vercel deploy (no data yet).

### Phase 2 — data layer + sidebar (Day 2, ~3.5h)
Upstash Redis provisioning via Vercel Marketplace. Seeder with 24h trend backfill (`faker.seed(42)`). `/api/bins` route with `next: { revalidate: 5 }`. Sidebar: region summary progress bars, trend sparkline (D3 line, no library), bin detail panel. Virtualised vehicle list with SOC-ascending sort. URL-synced filters.

### Phase 3 — realtime + polish (Day 3, ~3.5h)
QStash scheduled writer → `/api/writer` (distributed lock). SSE `/api/stream` (Node runtime, heartbeat, pure reader, 5s poll). D3 animated transitions + reduced-motion branch. Legend + view-mode toggle (3 fill branches, 1 Zustand flag). Hover tooltip with keyboard fallback. ARIA live region. Mobile bottom sheet.

### Phase 4 — QA + ship (Day 4, ~2h)
Vitest + Playwright. Lighthouse audit (LCP, bundle size). React DevTools profiler on SSE tick (confirm zero reconcile). README. Loom. Final Vercel preview.

---

## Appendix: questions worth raising unprompted in the interview

1. **"The QStash free tier has a 60s minimum — I bridged it with a 5s SSE poll, but wanted to flag it."** Shows you read the docs, not just the tutorial.
2. **"SSE fan-out doesn't scale past ~50 concurrent viewers on serverless — production would need a persistent WS process or a managed service like Ably. I've named it in the plan rather than pretending it's a drop-in."** Shows you understand the ceiling you're working within.
3. **"The Kafka-swap isn't a one-liner — it requires the persistent-process architecture to hold a SUBSCRIBE connection. I've kept the plan honest about that."** Shows you checked the real constraint, not just copied the buzzword.
4. **"I chose red → amber → blue over the reference's purple-only scale because single-hue scales lose perceptual resolution and fail colourblind users — it's the same number of tokens to build."** Shows you made an active design decision with a reason.