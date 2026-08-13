'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFleetStore } from './fleetStore';
import { REGION_NAMES } from '@/lib/regions';
import type { RegionName, VehicleStatus } from '@/lib/types';

// URL-sync for filters (agents.md §3 "Zustand + URL-sync middleware", §6).
//
// Filter state is shareable and bookmarkable: ?region=delhi-ncr&status=driving.
// Implemented as a hook rather than Zustand middleware because next/navigation
// is only available inside the React tree — the store itself stays framework
// agnostic (and therefore unit-testable without a router).
//
// Direction of truth: URL → store on first mount (deep link wins), store → URL
// on every later change, via router.replace so filtering doesn't pollute history.

const STATUSES: VehicleStatus[] = ['driving', 'charging', 'parked'];

export function toRegionSlug(name: RegionName): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

export function fromRegionSlug(slug: string | null): RegionName | null {
  if (!slug) return null;
  return REGION_NAMES.find((n) => toRegionSlug(n) === slug.toLowerCase()) ?? null;
}

export function parseStatus(value: string | null): VehicleStatus | null {
  if (!value) return null;
  const lower = value.toLowerCase() as VehicleStatus;
  return STATUSES.includes(lower) ? lower : null;
}

export function useUrlSync(): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hydrated = useRef(false);

  // 1. URL → store, once. Invalid values are dropped rather than throwing.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const region = fromRegionSlug(searchParams.get('region'));
    const status = parseStatus(searchParams.get('status'));
    if (region || status) {
      useFleetStore.getState().setFilters({ region, status });
    }
  }, [searchParams]);

  // 2. store → URL, on change. Subscribed outside React so this hook never
  //    re-renders its host component when filters change.
  useEffect(() => {
    let lastQuery = '';
    const write = (region: RegionName | null, status: VehicleStatus | null) => {
      const params = new URLSearchParams();
      if (region) params.set('region', toRegionSlug(region));
      if (status) params.set('status', status);
      const query = params.toString();
      if (query === lastQuery) return;
      lastQuery = query;
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const { filters } = useFleetStore.getState();
    lastQuery = new URLSearchParams(
      Object.entries({
        ...(filters.region ? { region: toRegionSlug(filters.region) } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      })
    ).toString();

    return useFleetStore.subscribe((state, prev) => {
      if (state.filters === prev.filters) return;
      write(state.filters.region, state.filters.status);
    });
  }, [pathname, router]);
}
