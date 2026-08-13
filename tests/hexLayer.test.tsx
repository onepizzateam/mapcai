import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { geoMercator } from 'd3-geo';
import { HexLayer } from '@/app/components/map/HexLayer';
import { useFleetStore } from '@/store/fleetStore';
import { healthColour, healthIndex } from '@/lib/colourScale';
import type { BinSummary, FleetDiff } from '@/lib/types';

// SSE diff → D3 transition (agents.md §11 test checklist).
//
// This is the spec's single biggest performance lever (hard rule 1: "D3 owns the
// SVG DOM… no React reconciliation on SSE ticks"), and it's the kind of claim
// that silently regresses the moment someone selects live data into a component.
// So the test asserts all three halves of the contract:
//
//   1. the hexagon fill actually updates from the diff,
//   2. React does NOT re-render the layer (React.Profiler commit count stays at
//      its mount value — the programmatic version of the DevTools-profiler check
//      in §12 Phase 4),
//   3. the layer does NOT re-bin (hard rule 3) and reuses the same DOM nodes.

const binHexesSpy = vi.fn();

// Partial mock: real implementation, wrapped so re-bins can be counted.
vi.mock('@/lib/hexbin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hexbin')>();
  return {
    ...actual,
    binHexes: (...args: Parameters<typeof actual.binHexes>) => {
      binHexesSpy();
      return actual.binHexes(...args);
    },
  };
});

// Two metros, far enough apart to land in separate hexes at radius 28.
const bins: BinSummary[] = [
  {
    id: 'bin_001',
    lat: 28.61,
    lng: 77.21,
    vehicle_count: 1000,
    avg_soh: 95,
    open_exceptions: 0,
    region: 'Delhi NCR',
  },
  {
    id: 'bin_002',
    lat: 19.07,
    lng: 72.87,
    vehicle_count: 500,
    avg_soh: 92,
    open_exceptions: 5,
    region: 'Mumbai',
  },
];

const projection = geoMercator().scale(800).translate([400, 300]);

function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Renders the layer inside an <svg>, counting every React commit. */
function renderLayer() {
  let commits = 0;
  const view = render(
    <svg>
      <Profiler id="hex" onRender={() => { commits += 1; }}>
        <HexLayer projection={projection} radius={28} labelThreshold={500} />
      </Profiler>
    </svg>,
  );
  return {
    ...view,
    paths: () => Array.from(view.container.querySelectorAll<SVGPathElement>('path.hex')),
    commitsAtMount: commits,
    commits: () => commits,
  };
}

beforeEach(() => {
  binHexesSpy.mockClear();
  setReducedMotion(true); // deterministic: skips the 800ms transition
  useFleetStore.setState({
    // Fresh clones per test — applyDiff mutates these in place by design.
    bins: bins.map((b) => ({ ...b })),
    regions: [],
    totalVehicles: 1500,
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
});

afterEach(cleanup);

describe('HexLayer', () => {
  it('renders one hexagon per bin with accessible, focusable geometry', () => {
    const view = renderLayer();
    const paths = view.paths();

    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.getAttribute('role')).toBe('button');
      expect(path.getAttribute('d')).toMatch(/^m/i); // d3-hexbin path
    }

    // Roving tabindex: exactly ONE tab stop for the whole map (§6). Without it,
    // ~90 hexes would mean 90 tab stops before reaching the sidebar.
    expect(paths.filter((p) => p.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('recolours from a diff without re-rendering React or re-binning', async () => {
    const view = renderLayer();
    const before = view.paths();
    const beforeFill = before[0].getAttribute('fill');
    const commitsAfterMount = view.commits();

    expect(binHexesSpy).toHaveBeenCalledTimes(1);

    // A bin goes bad: SOH collapses and exceptions spike.
    const diff: FleetDiff = {
      ts: Date.now(),
      bins: [{ id: 'bin_001', vehicle_count: 1000, avg_soh: 55, open_exceptions: 300 }],
    };
    useFleetStore.getState().applyDiff(diff);

    await waitFor(() => {
      expect(view.paths()[0].getAttribute('fill')).not.toBe(beforeFill);
    });

    // 1. The new fill is exactly what the colour scale prescribes.
    expect(view.paths()[0].getAttribute('fill')).toBe(
      healthColour(healthIndex({ avg_soh: 55, open_exceptions: 300, vehicle_count: 1000 })),
    );

    // 2. Zero React commits on the tick — the whole point of hard rule 1.
    expect(view.commits()).toBe(commitsAfterMount);

    // 3. No re-bin, and the same DOM nodes were mutated rather than replaced.
    expect(binHexesSpy).toHaveBeenCalledTimes(1);
    expect(view.paths()[0]).toBe(before[0]);
    expect(view.paths()[1]).toBe(before[1]);
  });

  it('leaves untouched bins alone', async () => {
    const view = renderLayer();
    const untouchedBefore = view.paths()[1].getAttribute('fill');

    useFleetStore.getState().applyDiff({
      ts: Date.now(),
      bins: [{ id: 'bin_001', vehicle_count: 1000, avg_soh: 55, open_exceptions: 300 }],
    });

    await waitFor(() => expect(view.paths()[0].getAttribute('fill')).toBeTruthy());
    expect(view.paths()[1].getAttribute('fill')).toBe(untouchedBefore);
  });

  it('animates the recolour when motion is allowed', async () => {
    setReducedMotion(false);
    const view = renderLayer();
    const beforeFill = view.paths()[0].getAttribute('fill');

    useFleetStore.getState().applyDiff({
      ts: Date.now(),
      bins: [{ id: 'bin_001', vehicle_count: 1000, avg_soh: 55, open_exceptions: 300 }],
    });

    // The transition interpolates over 800ms, so the final value arrives late —
    // which is exactly the difference from the reduced-motion branch above.
    await waitFor(
      () => {
        expect(view.paths()[0].getAttribute('fill')).toBe(
          healthColour(healthIndex({ avg_soh: 55, open_exceptions: 300, vehicle_count: 1000 })),
        );
      },
      { timeout: 3000 },
    );

    expect(view.paths()[0].getAttribute('fill')).not.toBe(beforeFill);
    expect(binHexesSpy).toHaveBeenCalledTimes(1);
  });

  it('re-bins when the zoom tier changes, and only then', () => {
    const view = renderLayer();
    expect(binHexesSpy).toHaveBeenCalledTimes(1);

    // Crossing a breakpoint is the one legitimate reason to re-bin (hard rule 3).
    view.rerender(
      <svg>
        <HexLayer projection={projection} radius={18} labelThreshold={500} />
      </svg>,
    );
    expect(binHexesSpy).toHaveBeenCalledTimes(2);
  });
});
