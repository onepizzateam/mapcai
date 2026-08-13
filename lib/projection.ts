import { geoMercator, type GeoProjection } from 'd3-geo';
import type { Feature, MultiPolygon } from 'geojson';

export interface ProjectionInput {
  width: number;
  height: number;
  land: Feature<MultiPolygon>;
}

export function buildProjection({ width, height, land }: ProjectionInput): GeoProjection {
  const padding = 24;
  return geoMercator()
    .fitExtent([[padding, padding], [width - padding, height - padding]], land)
    .precision(0.1);
}

export function projectPoint(projection: GeoProjection, lng: number, lat: number): [number, number] | null {
  const p = projection([lng, lat]);
  return p ? [p[0], p[1]] : null;
}
