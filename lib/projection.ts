import { geoMercator, type GeoProjection } from 'd3-geo';

export interface ProjectionInput {
  width: number;
  height: number;
}

/**
 * World Mercator projection centred on India (78.9°E, 22.5°N).
 * The d3-zoom transform on <g.map-layer> handles all zooming.
 */
export function buildProjection({ width, height }: ProjectionInput): GeoProjection {
  return geoMercator()
    .center([82.0, 22.5])
    .scale(1100)
    .translate([width / 2, height / 2])
    .precision(0.1);
}

export function projectPoint(
  projection: GeoProjection,
  lng: number,
  lat: number
): [number, number] | null {
  const p = projection([lng, lat]);
  return p ? [p[0], p[1]] : null;
}
