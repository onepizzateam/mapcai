'use client';

import { useEffect, useRef, useState } from 'react';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';

// Fetches /public/india-states.topo.json ONCE and converts to GeoJSON. The
// result is cached at module scope so remounts / multiple consumers never
// re-fetch or re-parse (agents.md §4).

let cachedGeo: FeatureCollection<Geometry> | null = null;
let inflight: Promise<FeatureCollection<Geometry>> | null = null;

async function loadGeo(): Promise<FeatureCollection<Geometry>> {
  if (cachedGeo) return cachedGeo;
  if (inflight) return inflight;

  inflight = fetch('/india-states.topo.json')
    .then((res) => {
      if (!res.ok) throw new Error(`TopoJSON fetch failed: ${res.status}`);
      return res.json() as Promise<Topology>;
    })
    .then((topo) => {
      // Object key is normalised to "states" by the build step; fall back to
      // the first object if a future asset uses a different name.
      const key = topo.objects.states ? 'states' : Object.keys(topo.objects)[0];
      const fc = feature(
        topo,
        topo.objects[key] as GeometryCollection
      ) as unknown as FeatureCollection<Geometry>;
      cachedGeo = fc;
      inflight = null;
      return fc;
    });

  return inflight;
}

export interface UseIndiaGeo {
  geo: FeatureCollection<Geometry> | null;
  error: string | null;
}

export function useIndiaGeo(): UseIndiaGeo {
  const [geo, setGeo] = useState<FeatureCollection<Geometry> | null>(cachedGeo);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (cachedGeo) {
      setGeo(cachedGeo);
      return;
    }
    loadGeo()
      .then((fc) => {
        if (mounted.current) setGeo(fc);
      })
      .catch((err) => {
        if (mounted.current) setError(String(err));
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  return { geo, error };
}
