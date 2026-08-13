// SOCBar — state-of-charge bar with severity colour (agents.md §7 SOC tokens):
//   < 20%  critical (red) · 20–50% low (amber) · > 50% ok (green)

function severity(soc: number): string {
  if (soc < 20) return 'var(--color-soc-critical)';
  if (soc < 50) return 'var(--color-soc-low)';
  return 'var(--color-soc-ok)';
}

export function SOCBar({ soc }: { soc: number }) {
  const pct = Math.max(0, Math.min(100, soc));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="State of charge"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: severity(pct) }}
        />
      </div>
      <span className="w-9 text-right font-mono text-[11px] tabular-nums text-text-primary">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
