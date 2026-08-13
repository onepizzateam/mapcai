'use client';

import { useEffect, useRef, useState } from 'react';
import { feature, merge } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Geometry, Feature, MultiPolygon } from 'geojson';

export interface GeoBundle {
  states: FeatureCollection<Geometry>;
  land: Feature<MultiPolygon>;
}

let cached: GeoBundle | null = null;
let inflight: Promise<GeoBundle> | null = null;

async function loadTopoJson(path: string): Promise<Topology> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`TopoJSON fetch failed: ${res.status}`);
  return res.json() as Promise<Topology>;
}

async function loadGeo(): Promise<GeoBundle> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = Promise.all([
    loadTopoJson('/india-states.topo.json'),
    loadTopoJson('/world-countries.topo.json'),
  ])
    .then(([indiaTopo, worldTopo]) => {
      const indiaKey = 'states' in indiaTopo.objects ? 'states' : Object.keys(indiaTopo.objects)[0];
      const worldKey = 'countries' in worldTopo.objects ? 'countries' : Object.keys(worldTopo.objects)[0];
      if (!indiaKey || !worldKey) throw new Error('TopoJSON contains no geometry objects');

      const indiaObject = indiaTopo.objects[indiaKey] as GeometryCollection;
      const worldObject = worldTopo.objects[worldKey] as GeometryCollection;
      const indiaStates = feature(indiaTopo, indiaObject) as unknown as FeatureCollection<Geometry>;
      const worldCountries = feature(worldTopo, worldObject) as unknown as FeatureCollection<Geometry>;
      const states: FeatureCollection<Geometry> = {
        type: 'FeatureCollection',
        features: [...worldCountries.features, ...indiaStates.features],
      };
      const land = merge(
        worldTopo,
        worldObject.geometries as unknown as Parameters<typeof merge>[1]
      ) as unknown as Feature<MultiPolygon>;
      cached = { states, land };
      inflight = null;
      return cached;
    })
    .catch((error) => {
      inflight = null;
      throw error;
    });

  return inflight;
}

export interface UseIndiaGeo {
  geo: GeoBundle | null;
  error: string | null;
}

export function useIndiaGeo(): UseIndiaGeo {
  const [geo, setGeo] = useState<GeoBundle | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (cached) { setGeo(cached); return; }
    loadGeo()
      .then((bundle) => { if (mounted.current) setGeo(bundle); })
      .catch((err) => { if (mounted.current) setError(String(err)); });
    return () => { mounted.current = false; };
  }, []);

  return { geo, error };
}
