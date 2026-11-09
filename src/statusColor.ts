/**
 * statusColor.ts
 *
 * Color mapping for the uptime radar:
 *   - Hue:        inherited from the parent infrastructure (stable per-provider)
 *   - Saturation:  proportional to uptime percentage
 *   - Lightness:   encodes current status (live = bright, down = dark)
 *
 * Produces HSL strings suitable for SVG fill/stroke.
 */

import type { NodeStatus, MonitorNode } from './types';

// ── Lightness by status ─────────────────────────────────────────────

const STATUS_LIGHTNESS: Record<NodeStatus, number> = {
  up:       55,    // bright
  degraded: 38,    // dimmed
  down:     18,    // dark
  unknown:  30,    // neutral gray-ish
};

// ── Public API ──────────────────────────────────────────────────────

/**
 * Compute the fill color for a node arc segment.
 *
 * @param hue           Base hue from infrastructure [0, 360)
 * @param uptimePercent Uptime percentage [0, 100]
 * @param status        Current status
 * @returns             CSS HSL string
 */
export function nodeColor(
  hue: number,
  uptimePercent: number,
  status: NodeStatus,
): string {
  // Saturation: high uptime → vivid, low uptime → washed-out
  // Map [0,100] to [10,85] so even 0% uptime keeps a faint tint
  const saturation = 10 + (uptimePercent / 100) * 75;

  const lightness = STATUS_LIGHTNESS[status];

  // Unknown status forces achromatic (gray)
  if (status === 'unknown') {
    return `hsl(${hue}, 5%, ${lightness}%)`;
  }

  return `hsl(${hue}, ${saturation.toFixed(1)}%, ${lightness}%)`;
}

/**
 * Brighter variant for hover / selection highlights.
 */
export function nodeColorHover(
  hue: number,
  uptimePercent: number,
  status: NodeStatus,
): string {
  const saturation = 10 + (uptimePercent / 100) * 75;
  const lightness = Math.min(STATUS_LIGHTNESS[status] + 12, 75);

  if (status === 'unknown') {
    return `hsl(${hue}, 8%, ${lightness}%)`;
  }

  return `hsl(${hue}, ${saturation.toFixed(1)}%, ${lightness}%)`;
}

/**
 * Muted stroke color (for arc outlines and dependency lines).
 */
export function nodeStroke(hue: number, status: NodeStatus): string {
  if (status === 'unknown') return 'hsl(0, 0%, 25%)';
  if (status === 'down') return `hsl(${hue}, 20%, 25%)`;
  return `hsl(${hue}, 30%, 35%)`;
}

/**
 * Status-only badge color (for the details panel indicators).
 */
export function statusBadgeColor(status: NodeStatus): string {
  switch (status) {
    case 'up':       return '#22c55e';
    case 'degraded': return '#f59e0b';
    case 'down':     return '#ef4444';
    case 'unknown':  return '#6b7280';
  }
}

/**
 * History bar color (for the cylinder visualization).
 */
export function historyColor(status: NodeStatus): string {
  switch (status) {
    case 'up':       return '#22c55e';
    case 'degraded': return '#f59e0b';
    case 'down':     return '#ef4444';
    case 'unknown':  return '#374151';
  }
}

/** Status-only palette: current outage wins, then any failure in the last 48h. */
export function monochromeColor(node: Pick<MonitorNode, 'status' | 'history'>, now = Date.now()): string {
  if (node.status === 'down' || node.status === 'unknown') return '#ef4444';
  const recent = node.history.filter(entry => entry.timestamp >= now - 48 * 3600_000 && entry.timestamp <= now);
  if (recent.length && recent.every(entry => entry.status === 'down' || entry.status === 'unknown')) return '#ef4444';
  if (node.status === 'degraded' || recent.some(entry => entry.status !== 'up')) return '#f59e0b';
  return '#22c55e';
}
