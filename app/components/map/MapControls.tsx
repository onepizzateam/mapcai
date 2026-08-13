'use client';

import { useFleetStore } from '@/store/fleetStore';
import { HOTSPOTS } from '@/lib/regions';

// MapControls — zoom buttons + region filter pills (agents.md §3).
// Writes fleetStore.regionFilter; the region filter is mirrored to the URL by
// useUrlSync so the view is shareable/bookmarkable (agents.md §6).

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function MapControls({ onZoomIn, onZoomOut, onReset }: MapControlsProps) {
  const region = useFleetStore((s) => s.filters.region);
  const setFilters = useFleetStore((s) => s.setFilters);

  const pick = (r: string) => setFilters({ region: region === r ? null : r });

  return (
    <>
      {/* Zoom cluster — top-left */}
      <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-lg border border-border bg-surface/90 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Zoom in"
          className="grid h-8 w-8 place-items-center rounded-md text-lg text-text-primary hover:bg-bg"
        >
          +
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          className="grid h-8 w-8 place-items-center rounded-md text-lg text-text-primary hover:bg-bg"
        >
          −
        </button>
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset zoom"
          className="grid h-8 w-8 place-items-center rounded-md text-xs text-text-muted hover:bg-bg"
        >
          ⤾
        </button>
      </div>

      {/* Region filter pills — top-center, horizontally scrollable on mobile */}
      <div className="absolute inset-x-0 top-3 mx-auto flex max-w-[70%] flex-wrap justify-center gap-1">
        {HOTSPOTS.map(({ region: r }) => {
          const active = region === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => pick(r)}
              aria-pressed={active}
              className={[
                'rounded-full border px-3 py-1 text-xs font-medium shadow-sm backdrop-blur transition-colors',
                active
                  ? 'border-accent bg-accent text-white'
                  : 'border-border bg-surface/90 text-text-muted hover:text-text-primary',
              ].join(' ')}
            >
              {r}
            </button>
          );
        })}
      </div>
    </>
  );
}
