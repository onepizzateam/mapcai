import { create } from 'zustand';
import type {
  BinSummary,
  RegionSummary,
  FleetDiff,
  ViewMode,
  VehicleStatus,
  RegionName,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Zustand store (agents.md §3). Holds bins, region rollups, the current
// selection/hover, view mode, zoom tier and filters.
//
// CRITICAL (agents.md hard-rule 1): applyDiff MUTATES bin data in place and
// bumps a numeric `diffVersion`. The D3 layer subscribes to the store OUTSIDE
// React (store.subscribe) and drives transitions from a ref callback. React
// components must NOT re-render on SSE ticks — so live bin values live on a
// plain mutable array, and only lightweight scalars (selectedBinId, viewMode,
// filters) are React-reactive state.
// ---------------------------------------------------------------------------

export interface Filters {
  region: RegionName | null;
  status: VehicleStatus | null;
}

interface FleetState {
  // Data
  bins: BinSummary[]; // mutable — D3 reads by ref, applyDiff mutates in place
  regions: RegionSummary[];
  totalVehicles: number;
  lastUpdated: number;

  // Monotonic counter bumped by applyDiff. The D3 layer watches this via
  // store.subscribe; React components generally do NOT select it.
  diffVersion: number;

  // Selection / hover
  selectedBinId: string | null;
  hoveredBinId: string | null;

  // View
  viewMode: ViewMode;
  zoomTier: number; // index into ZOOM_BREAKPOINTS

  // Filters (mirrored to URL by useUrlSync)
  filters: Filters;

  // Live-feed status (drives LivePulse + aria-live copy)
  connected: boolean;
  liveUpdateCount: number;
  dataError: string | null;

  // --- actions ---
  setSnapshot: (data: {
    bins: BinSummary[];
    regions: RegionSummary[];
    total_vehicles: number;
    last_updated: number;
  }) => void;
  applyDiff: (diff: FleetDiff) => void;
  selectBin: (id: string | null) => void;
  hoverBin: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setZoomTier: (tier: number) => void;
  setFilters: (f: Partial<Filters>) => void;
  setConnected: (connected: boolean) => void;
  setDataError: (message: string | null) => void;
}

export const useFleetStore = create<FleetState>((set, get) => ({
  bins: [],
  regions: [],
  totalVehicles: 0,
  lastUpdated: 0,
  diffVersion: 0,

  selectedBinId: null,
  hoveredBinId: null,

  viewMode: 'combined',
  zoomTier: 0,

  filters: { region: null, status: null },

  connected: false,
  liveUpdateCount: 0,
  dataError: null,

  setSnapshot: ({ bins, regions, total_vehicles, last_updated }) =>
    set({
      bins,
      regions,
      totalVehicles: total_vehicles,
      lastUpdated: last_updated,
      diffVersion: get().diffVersion + 1,
      dataError: null,
    }),

  // Mutate matching bins in place (same array reference, so D3's bound data
  // updates without a React re-render), then bump diffVersion to notify the
  // out-of-React subscriber.
  applyDiff: (diff) => {
    const { bins } = get();
    const byId = new Map(bins.map((b) => [b.id, b]));
    for (const d of diff.bins) {
      const bin = byId.get(d.id);
      if (bin) {
        bin.vehicle_count = d.vehicle_count;
        bin.avg_soh = d.avg_soh;
        bin.open_exceptions = d.open_exceptions;
      }
    }
    set((s) => ({
      diffVersion: s.diffVersion + 1,
      lastUpdated: diff.ts,
      liveUpdateCount: s.liveUpdateCount + diff.bins.length,
    }));
  },

  selectBin: (id) => set({ selectedBinId: id }),
  hoverBin: (id) => set({ hoveredBinId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setZoomTier: (tier) => set({ zoomTier: tier }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  setConnected: (connected) => set({ connected }),
  setDataError: (message) => set({ dataError: message }),
}));

/** Non-reactive read for the D3 layer / event handlers. */
export const getFleetState = useFleetStore.getState;

/** Derived selector: the currently selected bin object (or null). */
export function selectSelectedBin(s: FleetState): BinSummary | null {
  return s.selectedBinId ? s.bins.find((b) => b.id === s.selectedBinId) ?? null : null;
}

/** Bins passing the active region filter (status filters vehicles, not bins). */
export function selectVisibleBins(s: FleetState): BinSummary[] {
  const { region } = s.filters;
  return region ? s.bins.filter((b) => b.region === region) : s.bins;
}
