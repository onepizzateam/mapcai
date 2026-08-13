'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { geoPath } from 'd3-geo';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type D3ZoomEvent } from 'd3-zoom';
import type { Feature, Geometry } from 'geojson';
import { useIndiaGeo } from './useIndiaGeo';
import { buildProjection } from '@/lib/projection';
import { ZOOM_BREAKPOINTS, tierForZoom } from '@/lib/hexbin';
import { useFleetStore } from '@/store/fleetStore';
import { HexLayer } from './HexLayer';
import { HexTooltip } from './HexTooltip';
import { HexLegend } from './HexLegend';
import { MapControls } from './MapControls';

// FleetMap — the D3 SVG canvas (agents.md §3, §4).
//
// - Renders India state outlines from the memoised projection.
// - d3-zoom drives a pure SVG transform on <g.map-layer> (zero JS recompute
//   per frame; agents.md hard-rule 3). Crossing a ZOOM_BREAKPOINT is the ONLY
//   time we re-bin — we bump the store's zoomTier (debounced 120ms) and pass
//   the tier's radius down to HexLayer, which re-joins its data.

const DEBOUNCE_MS = 120;

export function FleetMap() {
  const { geo, error } = useIndiaGeo();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mapLayerRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const tierDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const zoomTier = useFleetStore((s) => s.zoomTier);
  const setZoomTier = useFleetStore((s) => s.setZoomTier);
  const bins = useFleetStore((s) => s.bins);
  const tier = ZOOM_BREAKPOINTS[zoomTier] ?? ZOOM_BREAKPOINTS[0];

  useEffect(() => {
    bins.slice(0, 10).forEach((bin) => {
      console.log('BIN DEBUG', JSON.stringify({
        bin_id: bin.id,
        vehicle_count: bin.vehicle_count,
        stranded_count: bin.stranded_count,
        critical_soc_count: bin.critical_soc_count,
        raw_urgency:
          ((bin.stranded_count ?? 0) / Math.max(bin.vehicle_count, 1)) * 0.6 +
          ((bin.critical_soc_count ?? 0) / Math.max(bin.vehicle_count, 1)) * 0.4,
      }));
    });
  }, [bins]);

  // Observe container size for a responsive, fit-to-parent projection.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => {
    if (!geo || size.w === 0 || size.h === 0) return null;
    return buildProjection({ width: size.w, height: size.h });
  }, [geo, size.w, size.h]);

  const pathGen = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const statePaths = useMemo(() => {
    if (!geo || !pathGen) return [] as { d: string; key: string }[];
    return (geo.features as Feature<Geometry>[]).map((f, i) => ({
      d: pathGen(f) ?? '',
      key: String((f.properties as Record<string, unknown>)?.name ?? i),
    }));
  }, [geo, pathGen]);

  // Set up d3-zoom once the svg + map layer exist.
  useEffect(() => {
    const svg = svgRef.current;
    const layer = mapLayerRef.current;
    if (!svg || !layer) return;

    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        // Pure SVG transform — no React state, no recompute.
        if (mapLayerRef.current) {
          select(mapLayerRef.current).attr('transform', event.transform.toString());
        }

        // Only cross-tier changes re-bin. Debounced so a pinch doesn't thrash.
        const nextTierIndex = ZOOM_BREAKPOINTS.indexOf(tierForZoom(event.transform.k));
        if (nextTierIndex !== -1 && nextTierIndex !== useFleetStore.getState().zoomTier) {
          if (tierDebounce.current) clearTimeout(tierDebounce.current);
          tierDebounce.current = setTimeout(() => setZoomTier(nextTierIndex), DEBOUNCE_MS);
        }
      });

    select(svg).call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    return () => {
      select(svg).on('.zoom', null);
      if (tierDebounce.current) clearTimeout(tierDebounce.current);
    };
  }, [setZoomTier]);

  // Programmatic zoom controls handed to MapControls.
  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const zoomBehavior = zoomRef.current;
    if (svg && zoomBehavior) select(svg).transition().duration(200).call(zoomBehavior.scaleBy, factor);
  };
  const resetZoom = () => {
    const svg = svgRef.current;
    const zoomBehavior = zoomRef.current;
    if (svg && zoomBehavior) select(svg).transition().duration(200).call(zoomBehavior.transform, zoomIdentity);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-muted">
        Map failed to load · {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        role="img"
        aria-label="World map showing fleet health"
        className="block h-full w-full touch-none"
      >
        <rect
          className="map-pointer-capture"
          width={size.w}
          height={size.h}
          fill="transparent"
          pointerEvents="all"
        />
        <g ref={mapLayerRef} className="map-layer">
          {/* State outlines — static chrome, drawn once per projection. */}
          <g className="states" fill="var(--color-surface)" stroke="#e2e8f0" strokeWidth={0.5}>
            {statePaths.map((s) => (
              <path key={s.key} d={s.d} />
            ))}
          </g>

          {/* Hexbin layer — D3 owns everything inside this <g>. */}
          {projection && (
            <HexLayer
              projection={projection}
              width={size.w}
              height={size.h}
              radius={tier.radius}
              labelThreshold={tier.labelThreshold}
            />
          )}
        </g>
      </svg>

      {/* Overlays (HTML, positioned above the SVG). */}
      <MapControls onZoomIn={() => zoomBy(1.5)} onZoomOut={() => zoomBy(1 / 1.5)} onReset={resetZoom} />
      <HexLegend />
      <HexTooltip containerRef={containerRef} projection={projection} />
    </div>
  );
}
