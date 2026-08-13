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

async function loadGeo(): Promise<GeoBundle> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = fetch('/india-states.topo.json')
    .then(async (res) => {
      if (!res.ok) throw new Error(`TopoJSON fetch failed: ${res.status}`);
      return res.json() as Promise<Topology>;
    })
    .then((topo) => {
      const statesKey = 'states' in topo.objects ? 'states' : Object.keys(topo.objects)[0];
      if (!statesKey) throw new Error('TopoJSON contains no geometry objects');
      const statesObject = topo.objects[statesKey] as GeometryCollection;
      const states = feature(topo, statesObject) as unknown as FeatureCollection<Geometry>;
      const land = merge(
        topo,
        statesObject.geometries as unknown as Parameters<typeof merge>[1]
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
