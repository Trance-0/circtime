/**
 * HistoryCylinder.tsx
 *
 * Visualizes historical uptime checks as stacked horizontal bars
 * forming a "cylinder" effect.
 *
 * Each bar = one check interval.
 * Color = status (up/degraded/down/unknown).
 * Width/glow = latency (higher latency → wider glow on right).
 *
 * Most recent at top, oldest at bottom.
 */

import { useMemo } from 'react';
import type { HistoryEntry, TimeRange } from './types';
import { historyColor } from './statusColor';

// ── Time range filtering ────────────────────────────────────────────

const RANGE_MS: Record<TimeRange, number> = {
  '1h':  3_600_000,
  '24h': 86_400_000,
  '7d':  604_800_000,
  '30d': 2_592_000_000,
};

// ── Component ───────────────────────────────────────────────────────

interface Props {
  history: HistoryEntry[];
  timeRange: TimeRange;
}

export function HistoryCylinder({ history, timeRange }: Props) {
  const filtered = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[timeRange];
    return history.filter((h) => h.timestamp >= cutoff).reverse(); // newest first
  }, [history, timeRange]);

  if (filtered.length === 0) {
    return <div className="history-cylinder-empty">No history data for this range</div>;
  }

  // Normalize latency for glow width
  const maxLatency = Math.max(...filtered.map((h) => h.latencyMs), 1);

  const BAR_HEIGHT = Math.max(2, Math.min(6, 200 / filtered.length));
  const WIDTH = 220;
  const HEIGHT = filtered.length * BAR_HEIGHT;

  return (
    <div className="history-cylinder">
      <div className="history-cylinder-label">
        <span>Recent</span>
        <span>History</span>
        <span>Oldest</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="history-cylinder-svg"
        preserveAspectRatio="none"
      >
        <defs>
          {/* Subtle cylinder shading gradient */}
          <linearGradient id="cylinder-shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
          </linearGradient>
        </defs>

        {filtered.map((entry, i) => {
          const y = i * BAR_HEIGHT;
          const color = historyColor(entry.status);

          // Latency glow: extends the bar on the right side
          const latencyFrac = entry.latencyMs / maxLatency;
          const barWidth = 160 + latencyFrac * 60;

          return (
            <g key={i}>
              {/* Main bar */}
              <rect
                x={0}
                y={y}
                width={barWidth}
                height={BAR_HEIGHT}
                fill={color}
                opacity={0.85}
              />
              {/* Latency glow effect */}
              {entry.latencyMs > 0 && (
                <rect
                  x={barWidth - 10}
                  y={y}
                  width={20}
                  height={BAR_HEIGHT}
                  fill={color}
                  opacity={0.3 + latencyFrac * 0.4}
                  rx={2}
                />
              )}
            </g>
          );
        })}

        {/* Cylinder shading overlay */}
        <rect
          x={0}
          y={0}
          width={WIDTH}
          height={HEIGHT}
          fill="url(#cylinder-shade)"
          pointerEvents="none"
        />
      </svg>
      <div className="history-cylinder-legend">
        <span className="legend-dot" style={{ background: historyColor('up') }} /> up
        <span className="legend-dot" style={{ background: historyColor('degraded') }} /> degraded
        <span className="legend-dot" style={{ background: historyColor('down') }} /> down
        <span className="legend-dot" style={{ background: historyColor('unknown') }} /> unknown
        <span style={{ marginLeft: 12, color: '#9ca3af', fontSize: 11 }}>
          Bar width = latency
        </span>
      </div>
    </div>
  );
}
