/**
 * Tooltip.tsx
 *
 * Hover tooltip showing name, status, uptime, latency for a node.
 */

import type { TooltipData } from './types';
import { statusBadgeColor } from './statusColor';

interface Props {
  data: TooltipData | null;
}

export function Tooltip({ data }: Props) {
  if (!data) return null;

  const { x, y, node } = data;

  return (
    <div
      className="tooltip"
      style={{
        left: x + 16,
        top: y - 10,
      }}
    >
      <div className="tooltip-header">
        <span
          className="tooltip-dot"
          style={{ background: statusBadgeColor(node.status) }}
        />
        <strong>{node.name}</strong>
      </div>
      <div className="tooltip-row">
        Status: <span style={{ color: statusBadgeColor(node.status) }}>{node.status}</span>
      </div>
      <div className="tooltip-row">Uptime: {node.uptimePercent.toFixed(2)}%</div>
      <div className="tooltip-row">Latency: {node.avgLatencyMs}ms avg / {node.p95LatencyMs}ms p95</div>
      <div className="tooltip-row" style={{ color: '#9ca3af', fontSize: 11 }}>
        {node.type}
      </div>
    </div>
  );
}
