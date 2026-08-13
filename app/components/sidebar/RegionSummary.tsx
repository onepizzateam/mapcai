'use client';

import { useFleetStore } from '@/store/fleetStore';
import { MetricRow } from '../ui/MetricRow';

// RegionSummary — the default sidebar view when no bin is selected
// (agents.md §3). Reads region rollups from the store (populated by /api/bins).
//
// Copy drives action rather than restating raw stats (agents.md §6): the
// reference's "Open exceptions 21 · 11.2/1k" becomes "21 open · 11.2 per 1k
// vehicles", and clicking a region row applies the region filter.

/** Bar colour tracks alert pressure, using the same tokens as the SOC scale. */
function alertColour(alertsPer1k: number): string {
  if (alertsPer1k >= 12) return 'var(--color-health-low)';
  if (alertsPer1k >= 8) return 'var(--color-health-mid)';
  return 'var(--color-accent)';
}

export function RegionSummary() {
  const regions = useFleetStore((s) => s.regions);
  const total = useFleetStore((s) => s.totalVehicles);
  const activeRegion = useFleetStore((s) => s.filters.region);
  const setFilters = useFleetStore((s) => s.setFilters);
  const dataError = useFleetStore((s) => s.dataError);

  const fleetAlerts = regions.reduce(
    (sum, r) => sum + (r.alerts_per_1k * r.vehicle_count) / 1000,
    0
  );
  const fleetAlertsPer1k = total > 0 ? (fleetAlerts / total) * 1000 : 0;
  const maxShare = regions.reduce((m, r) => Math.max(m, r.share_pct), 0) || 1;

  if (regions.length === 0) {
    return (
      <div className="p-4">
        <p className="text-xs text-text-muted" role={dataError ? 'alert' : undefined}>
          {dataError ?? 'Loading fleet rollup — select a region on the map to filter.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Fleet overview
        </h2>
        <MetricRow label="Vehicles tracked" value={total.toLocaleString()} />
        <MetricRow
          label="Open exceptions"
          value={Math.round(fleetAlerts).toLocaleString()}
          hint={`· ${fleetAlertsPer1k.toFixed(1)} per 1k vehicles`}
        />
        <MetricRow label="Regions" value={regions.length} />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          By region
        </h2>
        <ul className="flex flex-col gap-2">
          {regions.map((r) => {
            const active = activeRegion === r.name;
            return (
              <li key={r.name}>
                <button
                  type="button"
                  onClick={() => setFilters({ region: active ? null : r.name })}
                  aria-pressed={active}
                  className={[
                    'w-full rounded-md border px-2 py-2 text-left transition-colors',
                    active
                      ? 'border-accent bg-bg'
                      : 'border-transparent hover:border-border hover:bg-bg',
                  ].join(' ')}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary">{r.name}</span>
                    <span className="font-mono text-[11px] tabular-nums text-text-muted">
                      {r.vehicle_count.toLocaleString()}
                    </span>
                  </div>

                  {/* Share of fleet — bar length is share, colour is alert pressure. */}
                  <div
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
                    role="progressbar"
                    aria-valuenow={Math.round(r.share_pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${r.name} share of fleet`}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(r.share_pct / maxShare) * 100}%`,
                        backgroundColor: alertColour(r.alerts_per_1k),
                      }}
                    />
                  </div>

                  <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-text-muted">
                    <span>{r.share_pct.toFixed(1)}% of fleet</span>
                    <span>{r.alerts_per_1k.toFixed(1)} alerts/1k</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-[11px] text-text-muted">
        Select a hex on the map to see the vehicle breakdown.
      </p>
    </div>
  );
}
