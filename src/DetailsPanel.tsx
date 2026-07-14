/**
 * DetailsPanel.tsx
 *
 * Side panel showing detailed information about a selected node.
 */

import type { MonitorNode, TimeRange } from './types';
import { getNode, getHueFor } from './dataStore';
import { statusBadgeColor, nodeColor } from './statusColor';
import { HistoryCylinder } from './HistoryCylinder';

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface Props {
  node: MonitorNode;
  timeRange: TimeRange;
  onClose: () => void;
}

export function DetailsPanel({ node, timeRange, onClose }: Props) {
  const hue = getHueFor(node);
  const accentColor = nodeColor(hue, node.uptimePercent, 'up');

  const deps = node.dependsOn
    .map((id) => getNode(id))
    .filter((n): n is MonitorNode => !!n);

  const incidents = node.history
    .filter((h) => h.status !== 'up')
    .slice(-10)
    .reverse();

  return (
    <div className="details-panel">
      <div className="details-header">
        <div className="details-title-row">
          <span
            className="details-status-dot"
            style={{ background: statusBadgeColor(node.status) }}
          />
          <h2 className="details-title">{node.name}</h2>
        </div>
        <button className="details-close" onClick={onClose}>
          x
        </button>
      </div>

      <div className="details-meta">
        <div className="meta-row">
          <span className="meta-label">Type</span>
          <span className="meta-value">{statusLabel(node.type)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">Status</span>
          <span className="meta-value" style={{ color: statusBadgeColor(node.status) }}>
            {statusLabel(node.status)}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">Uptime</span>
          <span className="meta-value">
            <span className="uptime-bar-bg">
              <span
                className="uptime-bar-fill"
                style={{
                  width: `${node.uptimePercent}%`,
                  background: accentColor,
                }}
              />
            </span>
            {node.uptimePercent.toFixed(2)}%
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">Avg Latency</span>
          <span className="meta-value">{formatDuration(node.avgLatencyMs)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">P95 Latency</span>
          <span className="meta-value">{formatDuration(node.p95LatencyMs)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">Last Check</span>
          <span className="meta-value">{formatTime(node.lastCheckTime)}</span>
        </div>
      </div>

      {deps.length > 0 && (
        <div className="details-section">
          <h3 className="details-section-title">Dependencies</h3>
          <div className="dep-chain">
            {deps.map((dep) => (
              <div key={dep.id} className="dep-chip">
                <span
                  className="dep-dot"
                  style={{ background: statusBadgeColor(dep.status) }}
                />
                {dep.name}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="details-section">
        <h3 className="details-section-title">History</h3>
        <HistoryCylinder history={node.history} timeRange={timeRange} />
      </div>

      {incidents.length > 0 && (
        <div className="details-section">
          <h3 className="details-section-title">Recent Incidents</h3>
          <div className="incidents-list">
            {incidents.map((inc, i) => (
              <div key={i} className="incident-row">
                <span
                  className="incident-dot"
                  style={{ background: statusBadgeColor(inc.status) }}
                />
                <span className="incident-time">{formatTime(inc.timestamp)}</span>
                <span className="incident-msg">{inc.message}</span>
                {inc.latencyMs > 0 && (
                  <span className="incident-latency">{formatDuration(inc.latencyMs)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}