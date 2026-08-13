import { geoMercator, type GeoProjection } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';

// D3 Mercator projection sized to show the full world without geographic
// clipping. The decorative country underlay and the H3 bins share this view.

export interface ProjectionInput {
  width: number;
  height: number;
  geo?: FeatureCollection<Geometry>;
}

/**
 * Build a Mercator projection fitted to the given viewport and geometry.
 * precision(0.1) keeps the state outlines crisp without over-tessellating.
 */
export function buildProjection({ width, height, geo }: ProjectionInput): GeoProjection {
  const scale = Math.min(width / 6.4, height / 3.3);
  return geoMercator().center([0, 20]).scale(scale).translate([width / 2, height / 2]).precision(0.1);
}

/** Project a [lng, lat] pair to [x, y] pixels, or null if unprojectable. */
export function projectPoint(
  projection: GeoProjection,
  lng: number,
  lat: number
): [number, number] | null {
  const p = projection([lng, lat]);
  return p ? [p[0], p[1]] : null;
}
