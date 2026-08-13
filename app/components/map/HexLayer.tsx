'use client';

import { useEffect, useRef } from 'react';
import { select } from 'd3-selection';
import 'd3-transition'; // augments selection.prototype.transition
import { easeCubicOut } from 'd3-ease';
import type { GeoProjection } from 'd3-geo';
import { useFleetStore, getFleetState } from '@/store/fleetStore';
import { binHexes, hexPath, maxDensity, type HexDatum } from '@/lib/hexbin';
import { binFill } from '@/lib/colourScale';
import type { BinSummary, ViewMode } from '@/lib/types';

// ---------------------------------------------------------------------------
// HexLayer — D3 OWNS THIS SUBTREE (agents.md hard-rule 1).
//
// React renders the empty <g> once. Everything inside — hexagon <path>s, their
// fill/opacity, enter/exit, and the 800ms SSE transition — is driven by D3 via
// refs and an out-of-React store subscription. React state NEVER drives a
// hexbin re-render on a data tick.
// ---------------------------------------------------------------------------

const TRANSITION_MS = 800;

interface HexLayerProps {
  projection: GeoProjection;
  width?: number;
  height?: number;
  radius: number; // from the active zoom tier
  labelThreshold: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function HexLayer({ projection, width = 0, height = 0, radius, labelThreshold }: HexLayerProps) {
  const gRef = useRef<SVGGElement | null>(null);
  // Latest density max, kept available to the out-of-React SSE handler so it
  // can recolour without re-binning. Declared before the effects that use it.
  const lastRenderRef = useRef<{ dMax: number }>({ dMax: 1 });

  // Re-bin ONLY when the inputs that change binning change: projection,
  // radius (tier), or the set of bins (filter). NOT on SSE ticks — those
  // mutate values in place and are handled by the subscription below.

  const bins = useFleetStore((s) => s.bins);
  const regionFilter = useFleetStore((s) => s.filters.region);
  const viewMode = useFleetStore((s) => s.viewMode);

  // Draw / redraw the hexagons. Called on structural changes only.
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;

    const visible: BinSummary[] = regionFilter
      ? bins.filter((b) => b.region === regionFilter)
      : bins;

    const hexes = binHexes(visible, projection, radius, width, height);
    const dMax = maxDensity(hexes);
    const mode = getFleetState().viewMode;
    console.log(`[FleetMap] bins received: ${visible.length}`);
    console.log('[FleetMap] sample encodings:', hexes.slice(0, 5).map((hex) => ({
      bins: hex.bins.map((bin) => bin.id),
      urgency: Number(urgencyFor(hex).toFixed(3)),
      fill: fillFor(hex, dMax, mode).fill,
      opacity: Number(fillFor(hex, dMax, mode).fillOpacity.toFixed(3)),
    })));
    const path = hexPath(radius);

    const root = select(g);

    // JOIN on a stable key so enter/exit is minimal at tier changes.
    const sel = root
      .selectAll<SVGPathElement, HexDatum>('path.hex')
      .data(hexes, (d) => keyFor(d));

    sel.exit().remove();

    const enter = sel
      .enter()
      .append('path')
      .attr('class', 'hex')
      .attr('d', path)
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('stroke', 'var(--color-surface)')
      .attr('stroke-width', 0.5)
      .attr('tabindex', -1)
      .attr('role', 'button')
      .attr('fill', (d) => fillFor(d, dMax, mode).fill)
      .attr('fill-opacity', (d) => fillFor(d, dMax, mode).fillOpacity)
      .on('click', (_event, d) => {
        // Selecting the largest source bin is the useful default for a hex
        // that aggregates several bins at overview tier.
        const primary = d.bins.reduce((a, b) =>
          b.vehicle_count > a.vehicle_count ? b : a
        );
        getFleetState().selectCountry(primary.country ?? null);
      })
      .on('mouseenter', (_event, d) => {
        const primary = d.bins[0];
        getFleetState().hoverBin(primary ? primary.id : null);
        highlightCountry(g, primary?.country ?? null);
      })
      .on('mouseleave', () => { getFleetState().hoverBin(null); highlightCountry(g, null); })
      // Keyboard fallback for the hover tooltip (agents.md §6): focus behaves
      // exactly like hover, so the tooltip is reachable without a pointer.
      .on('focus', function (_event, d) {
        const primary = d.bins[0];
        getFleetState().hoverBin(primary ? primary.id : null);
        highlightCountry(g, primary?.country ?? null);
        moveRovingTabindex(this);
      })
      .on('blur', () => { getFleetState().hoverBin(null); highlightCountry(g, null); })
      .on('keydown', function (event: KeyboardEvent, d) {
        handleHexKeydown(event, d, this, gRef.current);
      });


    // Existing hexes: update geometry immediately (tier changed → new path).
    sel
      .attr('d', path)
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('fill', (d) => fillFor(d, dMax, mode).fill)
      .attr('fill-opacity', (d) => fillFor(d, dMax, mode).fillOpacity);

    enter.append('title'); // native tooltip fallback; rich tooltip is separate
    root
      .selectAll<SVGPathElement, HexDatum>('path.hex')
      .select<SVGTitleElement>('title')
      .text((d) => titleFor(d, labelThreshold));

    // Roving tabindex: exactly ONE hex is in the tab order (agents.md §6).
    // Without this, ~90 hexes would mean 90 tab stops before the sidebar.
    // Arrow keys move focus between hexes; Tab leaves the map entirely.
    const nodes = root.selectAll<SVGPathElement, HexDatum>('path.hex').nodes();
    if (nodes.length > 0 && !nodes.some((n) => n.getAttribute('tabindex') === '0')) {
      nodes[0].setAttribute('tabindex', '0');
    }


    // Stash the current density max + hexes so the SSE subscription can recolour
    // without re-binning.
    lastRenderRef.current = { dMax };
  }, [bins, regionFilter, projection, width, height, radius, labelThreshold, viewMode]);

  // -------------------------------------------------------------------------

  // OUT-OF-REACT SSE recolour. Subscribe to diffVersion; on change, recolour
  // the EXISTING <path>s with a D3 transition. No re-bin, no React re-render.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const unsub = useFleetStore.subscribe((state, prev) => {
      if (state.diffVersion === prev.diffVersion) return;
      const g = gRef.current;
      if (!g) return;

      const mode: ViewMode = state.viewMode;
      const dMax = lastRenderRef.current.dMax;

      const paths = select(g).selectAll<SVGPathElement, HexDatum>('path.hex');
      const reduced = prefersReducedMotion();

      paths.each(function (d) {
        // Recompute the hex aggregate from its (mutated-in-place) source bins.
        const agg = reaggregate(d);
        const { fill, fillOpacity } = fillFor(agg, dMax, mode);
        const node = select(this);
        if (reduced) {
          node.interrupt().attr('fill', fill).attr('fill-opacity', fillOpacity);
        } else {
          node
            .transition()
            .duration(TRANSITION_MS)
            .ease(easeCubicOut)
            .attr('fill', fill)
            .attr('fill-opacity', fillOpacity);
        }
      });
    });
    return unsub;
  }, []);

  return <g ref={gRef} className="hexbin" aria-label="Fleet health hexbins" />;
}

// --- helpers -------------------------------------------------------------

function keyFor(d: HexDatum): string {
  // Stable bin identity, not array position, so joins survive live updates.
  return d.bins.map((bin) => bin.id).sort().join('|');
}

function reaggregate(d: HexDatum): HexDatum {
  const vehicle_count = d.bins.reduce((s, b) => s + b.vehicle_count, 0);
  const open_exceptions = d.bins.reduce((s, b) => s + b.open_exceptions, 0);
  const avg_soh =
    vehicle_count > 0
      ? d.bins.reduce((s, b) => s + b.avg_soh * b.vehicle_count, 0) / vehicle_count
      : 0;
  // Mutate the datum so subsequent reads stay consistent.
  d.vehicle_count = vehicle_count;
  d.open_exceptions = open_exceptions;
  d.avg_soh = avg_soh;
  d.avg_soc = d.bins.reduce((s, b) => s + (b.avg_soc ?? b.avg_soh ?? 0) * b.vehicle_count, 0) / Math.max(1, vehicle_count);
  d.stranded_count = d.bins.reduce((s, b) => s + (b.stranded_count ?? 0), 0);
  d.critical_soc_count = d.bins.reduce((s, b) => s + (b.critical_soc_count ?? 0), 0);
  return d;
}

function fillFor(d: HexDatum, dMax: number, mode: ViewMode) {
  // At overview zoom, a hex can aggregate several source bins. Preserve the
  // most urgent source-bin signal so a stranded cluster cannot disappear into
  // a harmless-looking weighted average.
  const peakUrgency = d.bins.reduce((peak, bin) => {
    const count = Math.max(1, bin.vehicle_count);
    const urgency = ((bin.stranded_count ?? 0) / count) * 0.6 + ((bin.critical_soc_count ?? 0) / count) * 0.4;
    return Math.max(peak, Math.min(1, Math.max(0, urgency)));
  }, 0);
  return binFill(
    {
      avg_soc: d.bins.some((b) => b.avg_soc !== undefined) ? d.avg_soc : undefined,
      avg_soh: d.avg_soh,
      open_exceptions: d.open_exceptions,
      stranded_count: d.stranded_count,
      critical_soc_count: d.critical_soc_count,
      vehicle_count: d.vehicle_count,
      urgencyOverride: peakUrgency,
    },
    d.vehicle_count / 800,
    mode
  );
}

function urgencyFor(d: HexDatum): number {
  const count = Math.max(1, d.vehicle_count);
  return Math.min(1, Math.max(0, ((d.stranded_count ?? 0) / count) * 0.6 + ((d.critical_soc_count ?? 0) / count) * 0.4));
}

function titleFor(d: HexDatum, labelThreshold: number): string {
  const region = d.bins[0]?.region ?? 'Unknown';
  const label =
    d.vehicle_count >= labelThreshold ? `${d.vehicle_count} vehicles` : '';
  return `${region}${label ? ` · ${label}` : ''} · SOH ${d.avg_soh.toFixed(0)}% · ${d.open_exceptions} open`;
}

// --- keyboard navigation (agents.md §6) ----------------------------------
// Roving tabindex + arrow keys + Enter. Pure DOM attribute management — no
// library, and no React state, so this stays inside D3's subtree.

/** Make `node` the single tab stop, clearing the previous one. */
function moveRovingTabindex(node: SVGPathElement): void {
  const parent = node.parentNode as SVGGElement | null;
  if (!parent) return;
  parent.querySelectorAll('path.hex[tabindex="0"]').forEach((el) => {
    if (el !== node) el.setAttribute('tabindex', '-1');
  });
  node.setAttribute('tabindex', '0');
}

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

function handleHexKeydown(
  event: KeyboardEvent,
  d: HexDatum,
  node: SVGPathElement,
  container: SVGGElement | null
): void {
  // Enter / Space select, matching role="button" semantics.
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const primary = d.bins.reduce((a, b) => (b.vehicle_count > a.vehicle_count ? b : a));
    getFleetState().selectCountry(primary.country ?? null);
    return;
  }

  if (event.key === 'Escape') {
    getFleetState().selectBin(null);
    return;
  }

  const direction = ARROWS[event.key];
  if (!direction || !container) return;
  event.preventDefault();

  const next = nearestInDirection(d, direction, container);
  if (next) {
    moveRovingTabindex(next);
    next.focus();
  }
}

function highlightCountry(g: SVGGElement, country: string | null) {
  const paths = select(g).selectAll<SVGPathElement, HexDatum>('path.hex');
  const reduced = prefersReducedMotion();
  paths.each(function (d) {
    const same = Boolean(country && d.bins[0]?.country === country);
    const node = select(this);
    if (reduced) node.interrupt().attr('stroke-width', same ? 1.5 : 0.5);
    else node.transition().duration(150).attr('stroke-width', same ? 1.5 : 0.5);
  });
}

/**
 * Nearest hex in the pressed direction. Hexagons aren't a grid — a row is
 * offset by half a cell — so "the next element" is geometric, not index-based:
 * score candidates by distance, penalising drift perpendicular to travel so
 * ArrowRight prefers a true neighbour over a diagonal one.
 */
function nearestInDirection(
  from: HexDatum,
  [dx, dy]: [number, number],
  container: SVGGElement
): SVGPathElement | null {
  let best: SVGPathElement | null = null;
  let bestScore = Infinity;

  container.querySelectorAll<SVGPathElement>('path.hex').forEach((el) => {
    const datum = select<SVGPathElement, HexDatum>(el).datum();
    if (!datum || datum === from) return;

    const along = (datum.x - from.x) * dx + (datum.y - from.y) * dy;
    if (along <= 0) return; // behind us, or perpendicular

    const perpendicular = Math.abs((datum.x - from.x) * dy + (datum.y - from.y) * dx);
    const score = along + perpendicular * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  });

  return best;
}


