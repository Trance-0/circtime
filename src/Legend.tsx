/**
 * Legend.tsx
 *
 * Explains the hue / saturation / brightness mapping:
 *   Hue        → infrastructure identity
 *   Saturation → uptime percentage
 *   Brightness → current status
 */

import { getInfrastructures } from './mockData';
import { nodeColor } from './statusColor';
import type { NodeStatus } from './types';

const STATUSES: { status: NodeStatus; label: string }[] = [
  { status: 'up', label: 'Up' },
  { status: 'degraded', label: 'Degraded' },
  { status: 'down', label: 'Down' },
  { status: 'unknown', label: 'Unknown' },
];

export function Legend() {
  const infras = getInfrastructures();

  return (
    <div className="legend">
      <h3 className="legend-title">Legend</h3>

      {/* Infrastructure hues */}
      <div className="legend-section">
        <span className="legend-section-label">Infrastructure (Hue)</span>
        <div className="legend-items">
          {infras.map((inf) => (
            <div key={inf.id} className="legend-item">
              <span
                className="legend-swatch"
                style={{ background: nodeColor(inf.hue, 95, 'up') }}
              />
              <span>{inf.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status → brightness */}
      <div className="legend-section">
        <span className="legend-section-label">Status (Brightness)</span>
        <div className="legend-items">
          {STATUSES.map(({ status, label }) => (
            <div key={status} className="legend-item">
              <span
                className="legend-swatch"
                style={{ background: nodeColor(210, 90, status) }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Saturation explanation */}
      <div className="legend-section">
        <span className="legend-section-label">Uptime → Saturation</span>
        <div className="legend-gradient-row">
          <span className="legend-gradient-label">0%</span>
          <div className="legend-gradient">
            {Array.from({ length: 10 }, (_, i) => {
              const pct = i * 11;
              return (
                <span
                  key={i}
                  className="legend-gradient-cell"
                  style={{ background: nodeColor(210, pct, 'up') }}
                />
              );
            })}
          </div>
          <span className="legend-gradient-label">100%</span>
        </div>
      </div>

      {/* Ring layout */}
      <div className="legend-section">
        <span className="legend-section-label">Ring Layout</span>
        <div className="legend-rings">
          <span className="legend-ring-label">Inner → Infrastructure</span>
          <span className="legend-ring-label">Middle → Services</span>
          <span className="legend-ring-label">Outer → Network (optional)</span>
        </div>
      </div>
    </div>
  );
}
