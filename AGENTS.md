# Fleet Console — Implementation Plan
**Take-home assignment · Senior Frontend/UX lens**

---

## 0. What the screenshot tells us (and what it doesn't)

The Coulomb AI Fleet Console is a real-time EV fleet monitoring tool. The map is a D3 hexbin choropleth of India with a right-side stat panel that updates on bin click. Three weaknesses in the existing design that we can improve on:

1. **No time axis** — you can't see how a region's health is trending, only a point-in-time snapshot.
2. **The right panel is a flat list** — vehicles are shown with status badges but no scannable hierarchy (SOC criticality, exception severity).
3. **Colour scale is purely density** — it encodes vehicle count, not fleet health. A bin with 2,000 vehicles all at SOC 5% looks identical to one with 2,000 healthy vehicles.

Our version will fix all three while keeping the same basic layout shell.

---

## 1. Technical decisions

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 14 App Router** | SSR for initial map data, RSC for sidebar, streaming for live updates. Vercel-native. |
| Map / Viz | **D3 v7** (`d3-hexbin`, `d3-geo`, `d3-scale`, `d3-zoom`) | Full control over hexbin radius, projection, colour scale. No map tile dependency = no API key, no latency. |
| Realtime | **Vercel KV (Redis)** + **Server-Sent Events** | KV stores the fake fleet state; an SSE route (`/api/stream`) pushes diffs every 5 s. No WebSocket server to manage. |
| Styling | **Tailwind CSS v3** + CSS custom properties | Utility classes for layout, CSS vars for the design token system (so the theme is one file). |
| State | **Zustand** (tiny, no boilerplate) | Holds selected bin, filter state, streaming updates. Avoids prop drilling across map ↔ sidebar. |
| Data gen | **Faker.js** in a seeder script | Runs once on `vercel dev` or via a `/api/seed` endpoint. Deterministic seed so the demo is reproducible. |
| Fonts | **Inter** (data/UI) + **DM Mono** (numbers/IDs) | Inter is legible at 11px; DM Mono gives plate numbers and SOC values a techy, unambiguous read. |

### Why D3 directly (not Deck.gl / react-map-gl)?

- Deck.gl's `HexagonLayer` is GPU-accelerated but opinionated — custom tooltip, click handlers, and colour scale logic all fight the API.
- We need pixel-level control over hexbin shape, the health/density dual encoding, and the animated state transitions.
- For 25k vehicles binned into ~80 hexagons, D3 on a plain SVG is fast enough with `will-change: transform` and a `useMemo` on the projection.

### Colour encoding (the key improvement)

Instead of a single density scale, each hexbin carries two signals rendered as a **stacked visual**:

- **Fill hue** → fleet health index `(avg_SOH × (1 - exception_rate))`, mapped `[0, 1]` → `[#EF4444 (red), #6366F1 (indigo), #22C55E (green)]` via a diverging scale.
- **Fill opacity** → vehicle count (density), so sparse regions are translucent and dense ones are solid.

This means a dense-but-unhealthy bin reads as a **solid red**, a sparse-but-healthy bin reads as a **faint green**, and the original problem (density masking health) is solved.

---

## 2. Data model

### Redis schema (Vercel KV)

```
fleet:meta                        → Hash  { total_vehicles, last_updated }
fleet:bin:{h3_index}              → Hash  { lat, lng, vehicle_count, avg_soh, open_exceptions, region }
fleet:bin:{h3_index}:vehicles     → List  [ vehicle_id, ... ]  (trimmed to 50 for sidebar)
fleet:vehicle:{id}                → Hash  { id, model, soc, status, soh, bin, lat, lng }
fleet:region:{name}:summary       → Hash  { vehicle_count, alerts_per_1k, share_pct }
fleet:alerts:recent               → Sorted Set  (score = timestamp, member = alert_json)
```

All bin data is read in one `MGET` call (pipeline) — O(n_bins) not O(n_vehicles). The vehicle list is fetched only on bin select.

### Fake data seeder (`scripts/seed.ts`)

```typescript
// 25,000 vehicles distributed across ~90 hex bins
// Bins clustered around real EV hotspots: Delhi NCR, Mumbai, Bangalore, Hyderabad, Chennai, Pune, Surat, Ahmedabad
// SOH follows a beta distribution (most vehicles 85–98%, long tail below 70%)
// SOC is uniform [5%, 100%] to give interesting statuses
// Open exceptions: Poisson(λ=8) per 1000 vehicles
// Status: 65% Driving, 25% Charging, 10% Parked
```

The seeder is idempotent and tagged with a version key — re-running it with `--force` clears and re-seeds.

---

## 3. Architecture

```
app/
├── layout.tsx                    # Root layout: fonts, Zustand provider
├── page.tsx                      # Fleet Console page (RSC shell)
│
├── components/
│   ├── map/
│   │   ├── FleetMap.tsx          # D3 SVG map, zoom, pan (client component)
│   │   ├── HexLayer.tsx          # Renders hexbins, handles click → store
│   │   ├── HexTooltip.tsx        # Floating tooltip on hover
│   │   ├── MapControls.tsx       # +/- zoom, reset, region filter pills
│   │   └── useIndiaGeo.ts        # Fetches TopoJSON once, memoises projection
│   │
│   ├── sidebar/
│   │   ├── Sidebar.tsx           # Conditional: summary view ↔ bin detail view
│   │   ├── RegionSummary.tsx     # North/East/West/South bars (top panel)
│   │   ├── BinDetail.tsx         # Selected bin stats
│   │   ├── VehicleList.tsx       # Virtualised list (react-window, 16 shown + load more)
│   │   └── VehicleCard.tsx       # ID, model, SOC bar, status badge
│   │
│   ├── ui/
│   │   ├── SOCBar.tsx            # Colour-coded battery bar (red <20%, amber <50%, green)
│   │   ├── StatusBadge.tsx       # Driving / Charging / Parked
│   │   ├── LivePulse.tsx         # Animated green dot for "25k vehicles live"
│   │   └── MetricRow.tsx         # Label + value + optional bar (reused in sidebar)
│   │
│   └── shell/
│       ├── Topbar.tsx
│       └── Nav.tsx               # Icon sidebar (collapsed, icons only)
│
├── store/
│   └── fleetStore.ts             # Zustand: selectedBin, filters, streamedUpdates
│
├── app/api/
│   ├── bins/route.ts             # GET /api/bins → all bin summaries (cached 5s)
│   ├── bin/[id]/route.ts         # GET /api/bin/:id → bin detail + vehicle list
│   ├── stream/route.ts           # GET /api/stream → SSE, pushes bin diffs every 5s
│   └── seed/route.ts             # POST /api/seed → (re)seeds KV, dev only
│
├── lib/
│   ├── kv.ts                     # Vercel KV client + typed helpers
│   ├── projection.ts             # D3 Mercator for India, fixed bounds
│   ├── hexbin.ts                 # D3 hexbin config, radius = f(zoom)
│   ├── colourScale.ts            # Dual health/density colour encoding
│   └── faker/seed.ts             # Seeder logic
│
└── scripts/
    └── seed.ts                   # CLI seeder: npx tsx scripts/seed.ts
```

---

## 4. Map implementation detail

### Projection

```typescript
// India bounding box: roughly [68°E, 8°N] to [97°E, 37°N]
const projection = d3.geoMercator()
  .fitSize([width, height], indiaGeoJSON)
  .precision(0.1);
```

TopoJSON of India states (~200KB) is stored in `/public/india-states.topo.json`. Fetched once, cached in a module-level ref — subsequent renders are free.

### Hexbin

```typescript
const hexbin = d3.hexbin<BinDatum>()
  .x(d => projection([d.lng, d.lat])![0])
  .y(d => projection([d.lng, d.lat])![1])
  .radius(zoomAdjustedRadius); // 28px at zoom 1, scales with d3.zoom transform
```

Hexbins are computed in a `useMemo` that only re-runs when bin data or zoom level changes — not on every SSE tick.

### Zoom / Pan

```typescript
const zoom = d3.zoom<SVGSVGElement, unknown>()
  .scaleExtent([1, 6])
  .on('zoom', ({ transform }) => {
    svgRef.current!.select('g.map-layer').attr('transform', transform);
    // Recalculate hexbin radius so hexes stay visually consistent
    setZoom(transform.k);
  });
```

The hex radius shrinks as you zoom in, so individual vehicle clusters become visible at zoom 4+.

### Animation

D3 transitions on fill and opacity when SSE data arrives:

```typescript
hexagons.transition()
  .duration(800)
  .ease(d3.easeCubicOut)
  .attr('fill', d => colourScale(d.healthIndex))
  .attr('fill-opacity', d => densityScale(d.vehicleCount));
```

No React re-render on data update — D3 owns the DOM inside the SVG. React renders the SVG shell and passes data via refs/callbacks.

---

## 5. Real-time data flow

```
Vercel KV ←──── seeder (one-time or cron)
     │
     └──→ /api/stream (SSE, Next.js Route Handler)
               │   every 5s: randomly mutate 3-5 bins
               │   (SOC drift, new exceptions, status changes)
               │
               └──→ browser EventSource
                         │
                         └──→ Zustand fleetStore.applyDiff(diff)
                                   │
                                   └──→ D3 transition (no React re-render)
```

SSE diff payload (minimal, not full bin state):

```json
{
  "type": "bin_update",
  "bins": [
    { "id": "bin_042", "avg_soh": 91.3, "open_exceptions": 23, "vehicle_count": 1902 }
  ]
}
```

The client merges diffs into the existing bin map — no full refetch.

---

## 6. Improvements over the reference design

| Dimension | Reference (Coulomb AI) | Our version |
|---|---|---|
| **Colour encoding** | Single hue, density only | Dual: hue = health index, opacity = density |
| **Interactivity** | Click to select bin | Click + hover tooltip + keyboard navigation |
| **Time axis** | None | Sparkline in sidebar showing 24h SOH trend per region |
| **Vehicle list** | Flat list, 16 shown | Virtualised, sorted by SOC ascending (most critical first), load more |
| **Responsiveness** | Desktop only (assumed) | Sidebar collapses to bottom sheet on mobile |
| **Zoom** | No zoom visible | D3 zoom with dynamic hex radius + state-level label reveal at zoom 2+ |
| **Accessibility** | Unknown | ARIA labels on hexbins, keyboard-focusable, reduced-motion respected |
| **Filter** | None visible | Region filter pills, status filter (Driving / Charging / Parked) |
| **Performance** | Unknown | D3 owns SVG DOM (no React reconciliation), virtualised list, SSE diffs |

---

## 7. Design system

### Colour tokens

```css
--color-bg:          #F8F8FC;   /* slightly lavender white, not pure #fff */
--color-surface:     #FFFFFF;
--color-border:      #E4E4EF;
--color-text-primary:#111128;
--color-text-muted:  #6B6B8A;
--color-accent:      #5B5BD6;   /* indigo — matches hex healthy colour */

/* Health scale */
--color-health-low:  #EF4444;   /* red */
--color-health-mid:  #F59E0B;   /* amber */
--color-health-high: #5B5BD6;   /* indigo (healthy = brand colour) */

/* Status */
--color-driving:     #22C55E;
--color-charging:    #3B82F6;
--color-parked:      #9CA3AF;

/* SOC */
--color-soc-critical:#EF4444;   /* <20% */
--color-soc-low:     #F59E0B;   /* 20–50% */
--color-soc-ok:      #22C55E;   /* >50% */
```

### Typography

- **Inter Variable** — all UI text, labels, numbers in sidebar
- **DM Mono** — vehicle IDs, coordinates, raw numeric telemetry. Tabular nums, no ligatures.

---

## 8. Performance budget

| Metric | Target | How |
|---|---|---|
| LCP | < 1.5s | Map data is RSC-streamed; TopoJSON is pre-compressed (gzip ~40KB) |
| Hexbin render | < 16ms (60fps) | D3 owns SVG, no React reconciliation on zoom/pan |
| SSE latency | < 200ms end-to-end | Vercel Edge Runtime for `/api/stream` |
| Virtualised list scroll | 60fps | `react-window` FixedSizeList, vehicle cards are pure components |
| KV reads | < 5ms | `MGET` pipeline, edge KV region co-located with function |

---

## 9. Scalability path (beyond take-home)

This architecture naturally extends to production:

1. **H3 indexing** — swap fake lat/lng bins for real Uber H3 hexagon IDs (resolution 5). The KV schema is already keyed by bin ID, so swapping fake for H3 is a seeder change only.
2. **Kafka / real telemetry** — replace the fake SSE mutator with a Kafka consumer that writes diffs to KV. The SSE route reads from KV identically.
3. **Multi-fleet / multi-country** — the map projection is parameterised; switching from India to Germany is a one-line change. Fleet is a route param: `/fleet/:id/console`.
4. **Historical analytics** — the sidebar sparkline slot is already in the layout; wire it to a time-series store (Timescale / ClickHouse) behind a `/api/trend` endpoint.

---

## 10. File delivery checklist

- [ ] `scripts/seed.ts` — run `npx tsx scripts/seed.ts` to populate KV
- [ ] `public/india-states.topo.json` — sourced from Datameet (open licence)
- [ ] `.env.local.example` — `KV_URL`, `KV_REST_API_TOKEN`
- [ ] `README.md` — setup in 3 commands: `pnpm i && npx tsx scripts/seed.ts && pnpm dev`
- [ ] Deployed Vercel preview URL

---

## 11. Implementation phases

### Phase 1 — skeleton + map (Day 1, ~4h)
- Next.js project, Tailwind, Zustand, font setup
- TopoJSON India render with D3 Mercator projection
- Static hexbin layer with hardcoded fake bins
- Topbar + nav shell

### Phase 2 — data + sidebar (Day 2, ~3h)
- Vercel KV setup + seeder script (25k fake vehicles)
- `/api/bins` route → map gets real data
- Sidebar: region summary bars + selected bin detail
- Virtualised vehicle list

### Phase 3 — realtime + polish (Day 3, ~3h)
- SSE `/api/stream` route + KV mutator
- D3 animated transitions on data update
- Zoom/pan with dynamic hex radius
- Hover tooltip, keyboard nav, reduced-motion

### Phase 4 — improvements + QA (Day 4, ~2h)
- SOC-sorted vehicle list + status filters
- Mobile bottom-sheet sidebar
- Performance audit (Lighthouse, React DevTools)
- README + deployment