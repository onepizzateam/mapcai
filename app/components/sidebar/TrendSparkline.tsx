'use client';

import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { line, curveMonotoneX } from 'd3-shape';
import { extent } from 'd3-array';
import type { TrendPoint } from '@/lib/types';

// TrendSparkline — 24h avg-SOH trend (agents.md §3). Pure D3 path math rendered
// as an SVG <path> — NO charting library (hard rule). Adds the time axis the
// reference lacks: "91% avg SOH" is meaningless without knowing the direction.

interface TrendSparklineProps {
  data: TrendPoint[];
  width?: number;
  height?: number;
}

export function TrendSparkline({ data, width = 232, height = 48 }: TrendSparklineProps) {
  const { d, area, first, last, delta, min, max } = useMemo(() => {
    if (data.length < 2) {
      return { d: '', area: '', first: 0, last: 0, delta: 0, min: 0, max: 0 };
    }
    const pad = 4;
    const xs = data.map((p) => p.hour);
    const ys = data.map((p) => p.avg_soc ?? p.avg_soh ?? 0);
    const [x0, x1] = extent(xs) as [number, number];
    const [y0, y1] = extent(ys) as [number, number];

    const x = scaleLinear().domain([x0, x1]).range([pad, width - pad]);
    // Small vertical padding so the line doesn't clip at extremes.
    const y = scaleLinear().domain([y0 - 0.5, y1 + 0.5]).range([height - pad, pad]);

    const lineGen = line<TrendPoint>()
      .x((p) => x(p.hour))
      .y((p) => y(p.avg_soc ?? p.avg_soh ?? 0))
      .curve(curveMonotoneX);

    const path = lineGen(data) ?? '';
    const areaPath =
      `${path}L${x(x1)},${height - pad}L${x(x0)},${height - pad}Z`;

    const f = data[0].avg_soc ?? data[0].avg_soh ?? 0;
    const l = data[data.length - 1].avg_soc ?? data[data.length - 1].avg_soh ?? 0;
    return { d: path, area: areaPath, first: f, last: l, delta: l - f, min: y0, max: y1 };
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <div className="flex h-12 items-center text-[11px] text-text-muted">
        Not enough history yet
      </div>
    );
  }

  const rising = delta >= 0;
  const stroke = rising ? 'var(--color-soc-ok)' : 'var(--color-health-low)';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-text-muted">24h avg SOC</span>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: stroke }}
          aria-label={`${rising ? 'Up' : 'Down'} ${Math.abs(delta).toFixed(1)} percent over 24 hours`}
        >
          {rising ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
        </span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`24 hour SOC trend, ${first.toFixed(1)} to ${last.toFixed(1)} percent`}
        className="block"
      >
        <path d={area} fill={stroke} fillOpacity={0.1} />
        <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
      </svg>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-text-muted">
        <span>{min.toFixed(0)}%</span>
        <span>{max.toFixed(0)}%</span>
      </div>
    </div>
  );
}
