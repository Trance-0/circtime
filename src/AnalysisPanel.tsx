import { useMemo, useState } from 'react';
import { getAllNodes } from './dataStore';
import { statusBadgeColor } from './statusColor';
import type { HistoryEntry, MonitorNode, NodeStatus } from './types';

interface Props {
  dataVersion: number;
  node: MonitorNode;
  timestamp?: number;
}

interface SnapshotNode {
  node: MonitorNode;
  entry: HistoryEntry | undefined;
  status: NodeStatus;
}

function nearestEntry(node: MonitorNode, timestamp?: number): HistoryEntry | undefined {
  if (node.history.length === 0) return undefined;
  if (timestamp === undefined) return node.history[node.history.length - 1];
  return node.history.reduce((nearest, entry) =>
    Math.abs(entry.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? entry : nearest,
  node.history[0]);
}

function statusWeight(status: NodeStatus): number {
  if (status === 'down') return 100;
  if (status === 'degraded') return 55;
  if (status === 'unknown') return 12;
  return 0;
}

function layerLabel(type: MonitorNode['type']): string {
  if (type === 'network') return 'network layer';
  if (type === 'infrastructure') return 'infrastructure layer';
  return 'service layer';
}

function buildAnalysis(nodes: MonitorNode[], timestamp?: number) {
  const snapshots: SnapshotNode[] = nodes.map((node) => {
    const entry = nearestEntry(node, timestamp);
    return { node, entry, status: entry?.status ?? node.status };
  });
  const byId = new Map(snapshots.map((snapshot) => [snapshot.node.id, snapshot]));
  const dependents = new Map<string, SnapshotNode[]>();

  for (const snapshot of snapshots) {
    for (const dependencyId of snapshot.node.dependsOn) {
      const list = dependents.get(dependencyId) ?? [];
      list.push(snapshot);
      dependents.set(dependencyId, list);
    }
  }

  const ranked = snapshots
    .map((snapshot) => {
      const directDependents = dependents.get(snapshot.node.id) ?? [];
      const impacted = directDependents.filter((dependent) =>
        dependent.status === 'down' || dependent.status === 'degraded',
      );
      const layerBonus = snapshot.node.type === 'network' ? 30 : snapshot.node.type === 'infrastructure' ? 18 : 0;
      const score = statusWeight(snapshot.status) + impacted.length * 38 + directDependents.length * 3 + layerBonus;
      const reason = impacted.length > 1
        ? String(impacted.length) + ' unhealthy services share this dependency'
        : impacted.length === 1
          ? 'One unhealthy service depends on this node'
          : snapshot.status === 'down'
            ? 'This node is down on the selected time slice'
            : snapshot.status === 'degraded'
              ? 'This node is degraded on the selected time slice'
              : 'Weak dependency signal';

      return { ...snapshot, score, impacted, reason };
    })
    .filter((candidate) => candidate.status !== 'up' || candidate.impacted.length > 0)
    .sort((a, b) => b.score - a.score);

  return {
    selected: byId,
    ranked,
    unhealthy: snapshots.filter((snapshot) => snapshot.status === 'down' || snapshot.status === 'degraded'),
  };
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return 'Current';
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AnalysisPanel({ dataVersion, node, timestamp }: Props) {
  const [expanded, setExpanded] = useState(false);
  const analysis = useMemo(
    () => buildAnalysis(getAllNodes(), timestamp),
    [dataVersion, timestamp],
  );
  const selected = analysis.selected.get(node.id);
  const likelyCause = analysis.ranked[0];

  return (
    <>
      <button
        className="analysis-window"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
      >
        <span className="panel-label">Analysis</span>
        <strong>{analysis.unhealthy.length} affected</strong>
        <span>{likelyCause ? 'Likely ' + likelyCause.node.name : 'No fault pattern'}</span>
      </button>

      {expanded && (
        <div className="analysis-scrim" onClick={() => setExpanded(false)}>
          <section className="analysis-expanded" onClick={(event) => event.stopPropagation()}>
            <header className="analysis-header">
              <div>
                <span className="panel-label">Time-slice analysis</span>
                <h2>{node.name}</h2>
                <p>{formatTime(timestamp)} / {selected?.status ?? node.status}</p>
              </div>
              <button type="button" className="analysis-close" title="Close" onClick={() => setExpanded(false)}>X</button>
            </header>

            <div className="analysis-summary">
              <div>
                <span className="panel-label">Probable layer</span>
                <strong>{likelyCause ? layerLabel(likelyCause.node.type) : 'none'}</strong>
              </div>
              <div>
                <span className="panel-label">Likely cause</span>
                <strong>{likelyCause?.node.name ?? 'No fault pattern'}</strong>
              </div>
              <div>
                <span className="panel-label">Selected status</span>
                <strong style={{ color: statusBadgeColor(selected?.status ?? node.status) }}>
                  {selected?.status ?? node.status}
                </strong>
              </div>
            </div>

            <div className="analysis-columns">
              <section>
                <span className="panel-label">Fix order</span>
                <div className="analysis-list">
                  {analysis.ranked.slice(0, 8).map((candidate) => (
                    <div className="analysis-row" key={candidate.node.id}>
                      <span className="admin-status-dot" style={{ background: statusBadgeColor(candidate.status) }} />
                      <div>
                        <strong>{candidate.node.name}</strong>
                        <p>{candidate.reason}</p>
                        {candidate.impacted.length > 0 && (
                          <p>Impacts: {candidate.impacted.slice(0, 4).map((item) => item.node.name).join(', ')}</p>
                        )}
                      </div>
                      <span className="analysis-score">{candidate.score}</span>
                    </div>
                  ))}
                  {analysis.ranked.length === 0 && <p className="analysis-empty">No fault pattern on this slice.</p>}
                </div>
              </section>

              <section>
                <span className="panel-label">Unhealthy services</span>
                <div className="analysis-list">
                  {analysis.unhealthy.map((snapshot) => (
                    <div className="analysis-row compact" key={snapshot.node.id}>
                      <span className="admin-status-dot" style={{ background: statusBadgeColor(snapshot.status) }} />
                      <div>
                        <strong>{snapshot.node.name}</strong>
                        <p>{layerLabel(snapshot.node.type)} / {snapshot.status}</p>
                      </div>
                    </div>
                  ))}
                  {analysis.unhealthy.length === 0 && <p className="analysis-empty">All known services are healthy.</p>}
                </div>
              </section>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
