import type { HistoryEntry, MonitorNode, TooltipData } from './types';
import { statusBadgeColor } from './statusColor';

interface Props {
  data: TooltipData | null;
  selectedNode?: MonitorNode | null;
  timestamp?: number;
}

function nearestEntry(node: MonitorNode, timestamp?: number): HistoryEntry | undefined {
  if (node.history.length === 0) return undefined;
  if (timestamp === undefined) return node.history[node.history.length - 1];
  return node.history.reduce((nearest, entry) =>
    Math.abs(entry.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? entry : nearest,
  node.history[0]);
}

function formatSliceTime(timestamp?: number): string {
  if (!timestamp) return 'Current';
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Tooltip({ data, selectedNode, timestamp }: Props) {
  const node = selectedNode ?? data?.node;
  if (!node) return null;

  const entry = nearestEntry(node, timestamp);
  const status = entry?.status ?? node.status;
  const isPersistent = Boolean(selectedNode);

  return (
    <div
      className={'tooltip service-inspector' + (isPersistent ? ' persistent' : '')}
      style={!isPersistent && data ? { left: data.x + 16, top: data.y - 10 } : undefined}
    >
      <section className="inspector-section">
        <span className="panel-label">Service</span>
        <div className="tooltip-header">
          <span className="tooltip-dot" style={{ background: statusBadgeColor(node.status) }} />
          <strong>{node.name}</strong>
        </div>
        <div className="tooltip-row">{node.type}</div>
        <div className="tooltip-row">Uptime {node.uptimePercent.toFixed(2)}%</div>
        <div className="tooltip-row">Latency {node.avgLatencyMs}ms avg / {node.p95LatencyMs}ms p95</div>
        {node.dependsOn.length > 0 && (
          <div className="tooltip-row">Depends on {node.dependsOn.join(', ')}</div>
        )}
      </section>

      <section className="inspector-section time-slice-status">
        <span className="panel-label">Time slice</span>
        <div className="slice-status-row">
          <strong style={{ color: statusBadgeColor(status) }}>{status}</strong>
          <span>{formatSliceTime(entry?.timestamp ?? timestamp)}</span>
        </div>
        <div className="tooltip-row">
          {entry ? String(entry.latencyMs) + 'ms / HTTP ' + String(entry.statusCode || '-') : 'No snapshot data'}
        </div>
        {entry?.message && <div className="tooltip-row slice-message">{entry.message}</div>}
      </section>
    </div>
  );
}
