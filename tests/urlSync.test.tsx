import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { fromRegionSlug, parseStatus, toRegionSlug, useUrlSync } from '@/store/useUrlSync';
import { useFleetStore } from '@/store/fleetStore';

// filter → URL sync (agents.md §11 test checklist).
//
// Shareable, bookmarkable filter state is a §6 differentiator over the reference,
// so both directions are pinned: URL → store on mount (a deep link must win) and
// store → URL on change (via replace, so filtering never pollutes history).

const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/',
  useSearchParams: () => currentParams,
}));

/** Minimal host: the hook is the unit under test, not any particular UI. */
function Harness() {
  useUrlSync();
  return null;
}

beforeEach(() => {
  replace.mockClear();
  currentParams = new URLSearchParams();
  useFleetStore.setState({ filters: { region: null, status: null } });
});

afterEach(cleanup);

describe('slug helpers', () => {
  it('round-trips a region name through its slug', () => {
    expect(toRegionSlug('Delhi NCR')).toBe('delhi-ncr');
    expect(fromRegionSlug('delhi-ncr')).toBe('Delhi NCR');
  });

  it('drops unknown or empty values rather than throwing', () => {
    // A hand-edited URL is untrusted input; it must degrade to "no filter".
    expect(fromRegionSlug('atlantis')).toBeNull();
    expect(fromRegionSlug(null)).toBeNull();
    expect(parseStatus('teleporting')).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });

  it('accepts the three real statuses, case-insensitively', () => {
    expect(parseStatus('driving')).toBe('driving');
    expect(parseStatus('CHARGING')).toBe('charging');
    expect(parseStatus('parked')).toBe('parked');
  });
});

describe('useUrlSync', () => {
  it('hydrates the store from a deep link on mount', () => {
    currentParams = new URLSearchParams('region=delhi-ncr&status=driving');
    render(<Harness />);

    expect(useFleetStore.getState().filters).toEqual({
      region: 'Delhi NCR',
      status: 'driving',
    });
    // Hydrating is not a change — it must not immediately rewrite the URL.
    expect(replace).not.toHaveBeenCalled();
  });

  it('writes filters back to the URL as a replace, not a push', async () => {
    render(<Harness />);
    useFleetStore.getState().setFilters({ region: 'Mumbai', status: 'charging' });

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/?region=mumbai&status=charging', { scroll: false });
  });

  it('clears params when filters are reset', async () => {
    useFleetStore.setState({ filters: { region: 'Mumbai', status: null } });
    render(<Harness />);

    useFleetStore.getState().setFilters({ region: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/', { scroll: false }));
  });

  it('does not rewrite the URL when the query is unchanged', async () => {
    render(<Harness />);
    useFleetStore.getState().setFilters({ region: 'Mumbai' });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));

    // Same value again — the dedupe guard should swallow it. Without this, every
    // store touch would fire a navigation.
    useFleetStore.getState().setFilters({ region: 'Mumbai' });
    await Promise.resolve();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('ignores store changes that do not touch filters', async () => {
    render(<Harness />);
    useFleetStore.getState().setViewMode('density');
    useFleetStore.getState().selectBin('bin_001');

    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
  });
});
