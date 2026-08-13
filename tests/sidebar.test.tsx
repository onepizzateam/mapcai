import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { useFleetStore } from '@/store/fleetStore';
import { Sidebar } from '@/app/components/sidebar/Sidebar';
import type { BinDetail, BinSummary, RegionSummary, Vehicle } from '@/lib/types';

// bin-select → sidebar render (agents.md §11 test checklist).
//
// Covers the drill-down contract end to end at the component level: the sidebar
// swaps region summary → bin detail on selection, lazily fetches /api/bin/:id
// (rather than shipping vehicles in the snapshot), and renders the vehicle list
// SOC-ascending so it reads as a triage queue (§6).

const bins: BinSummary[] = [
  {
    id: 'bin_001',
    lat: 28.61,
    lng: 77.21,
    vehicle_count: 1200,
    avg_soh: 91.4,
    open_exceptions: 21,
    region: 'Delhi NCR',
  },
  {
    id: 'bin_002',
    lat: 19.07,
    lng: 72.87,
    vehicle_count: 800,
    avg_soh: 88.2,
    open_exceptions: 9,
    region: 'Mumbai',
  },
];

const regions: RegionSummary[] = [
  { name: 'Delhi NCR', vehicle_count: 1200, alerts_per_1k: 17.5, share_pct: 60 },
  { name: 'Mumbai', vehicle_count: 800, alerts_per_1k: 11.2, share_pct: 40 },
];

const vehicle = (id: string, soc: number): Vehicle => ({
  id,
  model: 'Tata Nexon EV',
  soc,
  status: 'driving',
  soh: 92,
  bin: 'bin_001',
  lat: 28.61,
  lng: 77.21,
});

// Deliberately unsorted so the assertion proves the component's ordering, not
// the fixture's.
const detail: BinDetail = {
  bin: bins[0],
  vehicles: [vehicle('veh_000090', 88), vehicle('veh_000007', 9), vehicle('veh_000042', 47)],
  trend: Array.from({ length: 24 }, (_, i) => ({ hour: 480_000 + i, avg_soh: 90 + (i % 3) })),
};

function resetStore() {
  useFleetStore.setState({
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
  });
}

beforeEach(() => {
  resetStore();
  useFleetStore.getState().setSnapshot({
    bins,
    regions,
    total_vehicles: 2000,
    last_updated: Date.now(),
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/bin/')) {
        return new Response(JSON.stringify(detail), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Selection normally originates from a click inside the D3 subtree, which React
 * knows nothing about — so tests drive the store directly, and wrap it in act()
 * to flush the resulting render. Without this, React logs an act() warning and
 * the noise buries genuine failures.
 */
function select(id: string | null) {
  act(() => {
    useFleetStore.getState().selectBin(id);
  });
}


describe('Sidebar', () => {
  it('shows the region summary while nothing is selected', () => {
    render(<Sidebar />);
    expect(screen.getByText('Delhi NCR')).toBeTruthy();
    // No bin detail chrome yet — and critically, no vehicle fetch.
    expect(screen.queryByRole('button', { name: /back to regions/i })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders bin detail and lazily fetches the vehicle payload on select', async () => {
    render(<Sidebar />);
    select('bin_001');

    // Summary numbers come from the store, so they paint before the fetch lands.
    expect(await screen.findByText('bin_001')).toBeTruthy();
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(screen.getByText('91.4%')).toBeTruthy();

    // "21 open · 11.2 per 1k" — copy that drives triage, not a raw stat (§6).
    expect(screen.getByText('21 open')).toBeTruthy();
    expect(screen.getByText(/17\.5 per 1k vehicles/)).toBeTruthy();

    await act(async () => {
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    });
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(
      '/api/bin/bin_001',
    );
  });

  it('orders the vehicle list by SOC ascending — most critical first', async () => {
    render(<Sidebar />);
    select('bin_001');

    await screen.findByText('Vehicles · lowest charge first');

    const ids = screen
      .getAllByText(/^veh_\d{6}$/)
      .map((node) => node.textContent as string);

    // Fixture order is 88 / 9 / 47; the list must re-sort to 9 / 47 / 88.
    expect(ids).toEqual(['veh_000007', 'veh_000042', 'veh_000090']);
  });

  it('returns to the region summary when the selection is cleared', async () => {
    render(<Sidebar />);
    select('bin_001');
    await screen.findByText('bin_001');

    select(null);
    await act(async () => {
      await waitFor(() => expect(screen.queryByText('bin_001')).toBeNull());
    });
    expect(screen.getByText('Delhi NCR')).toBeTruthy();
  });
});
