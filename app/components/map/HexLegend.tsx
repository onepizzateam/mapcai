'use client';

import { useFleetStore } from '@/store/fleetStore';
import { HEALTH_LOW, HEALTH_MID, HEALTH_HIGH, DENSITY_NEUTRAL } from '@/lib/colourScale';
import type { ViewMode } from '@/lib/types';

// HexLegend — colour scale legend + view-mode toggle (agents.md §6).
// The reference has NO legend; this explains the dual-channel encoding and is
// the most visible differentiator. Three fill-function branches behind one
// Zustand flag (viewMode).

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'combined', label: 'Combined' },
  { id: 'health', label: 'Health only' },
  { id: 'density', label: 'Density only' },
];

export function HexLegend() {
  const viewMode = useFleetStore((s) => s.viewMode);
  const setViewMode = useFleetStore((s) => s.setViewMode);

  const showHealth = viewMode === 'combined' || viewMode === 'health';
  const showDensity = viewMode === 'combined' || viewMode === 'density';

  return (
    <div className="absolute bottom-3 left-3 w-56 rounded-lg border border-border bg-surface/95 p-3 text-xs shadow-sm backdrop-blur">
      {/* View-mode toggle */}
      <div
        role="radiogroup"
        aria-label="Colour encoding mode"
        className="mb-3 flex gap-1 rounded-md bg-bg p-1"
      >
        {MODES.map((m) => {
          const active = viewMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setViewMode(m.id)}
              className={[
                'flex-1 rounded px-1 py-1 text-[11px] font-medium transition-colors',
                active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary',
              ].join(' ')}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Health hue ramp */}
      {showHealth && (
        <div className="mb-2">
          <div className="mb-1 font-medium text-text-primary">Fleet urgency</div>
          <div
            className="h-2 w-full rounded"
            style={{
              background: `linear-gradient(to right, ${HEALTH_HIGH}, ${HEALTH_MID}, ${HEALTH_LOW})`,
            }}
          />
          <div className="mt-1 flex justify-between text-[10px] text-text-muted">
            <span>Green · no stranded</span>
            <span>Amber · &gt;10% critical</span>
            <span>Red · stranded</span>
          </div>
        </div>
      )}

      {/* Density opacity ramp */}
      {showDensity && (
        <div>
          <div className="mb-1 font-medium text-text-primary">Vehicle density</div>
          <div
            className="h-2 w-full rounded"
            style={{
              background: `linear-gradient(to right, ${withAlpha(showHealth ? HEALTH_HIGH : DENSITY_NEUTRAL, 0.15)}, ${showHealth ? HEALTH_HIGH : DENSITY_NEUTRAL})`,
            }}
          />
          <div className="mt-1 flex justify-between text-[10px] text-text-muted">
            <span>Sparse · &lt;50</span>
            <span>Dense · 800+</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Hex colour → rgba with the given alpha, for the density gradient's faint end.
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
