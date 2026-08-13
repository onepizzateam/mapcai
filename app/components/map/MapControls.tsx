'use client';


// MapControls — zoom buttons + region filter pills (agents.md §3).
// Writes fleetStore.regionFilter; the region filter is mirrored to the URL by
// useUrlSync so the view is shareable/bookmarkable (agents.md §6).

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function MapControls({ onZoomIn, onZoomOut, onReset }: MapControlsProps) {
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

    </>
  );
}
