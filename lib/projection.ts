import { geoMercator, type GeoProjection } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';

// D3 Mercator projection, parameterised by viewport bounds and the India
// GeoJSON (agents.md §4). fitSize centres + scales the map to the container.

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
  const padding = 40;
  return geoMercator().center([78.9629, 22.5937]).scale(Math.min(width, height) * 1.25).translate([width / 2, height / 2]).precision(0.1);
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
