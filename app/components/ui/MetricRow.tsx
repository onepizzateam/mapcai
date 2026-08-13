import type { ReactNode } from 'react';

// MetricRow — label ↔ value row used throughout the sidebar. Value is mono +
// tabular so numbers align down a column (agents.md §7 typography).

interface MetricRowProps {
  label: string;
  value: ReactNode;
  hint?: string;
}

export function MetricRow({ label, value, hint }: MetricRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-right">
        <span className="font-mono text-sm tabular-nums text-text-primary">{value}</span>
        {hint ? <span className="ml-1 text-[11px] text-text-muted">{hint}</span> : null}
      </span>
    </div>
  );
}
