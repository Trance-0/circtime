/**
 * ControlPanel.tsx
 *
 * Dashboard controls:
 *   - Time range: 1h / 24h / 7d / 30d
 *   - Show/hide network layer
 *   - Sort by: name / uptime / status
 */

import type { TimeRange, SortBy } from './types';

interface Props {
  timeRange: TimeRange;
  showNetwork: boolean;
  sortBy: SortBy;
  onTimeRange: (tr: TimeRange) => void;
  onShowNetwork: (show: boolean) => void;
  onSortBy: (sort: SortBy) => void;
}

const TIME_RANGES: TimeRange[] = ['1h', '24h', '7d', '30d'];
const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'uptime', label: 'Uptime' },
  { value: 'status', label: 'Status' },
];

export function ControlPanel({
  timeRange,
  showNetwork,
  sortBy,
  onTimeRange,
  onShowNetwork,
  onSortBy,
}: Props) {
  return (
    <div className="control-panel">
      <div className="control-group">
        <span className="control-label">Time Range</span>
        <div className="control-buttons">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr}
              className={`control-btn ${timeRange === tr ? 'active' : ''}`}
              onClick={() => onTimeRange(tr)}
            >
              {tr}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <span className="control-label">Sort By</span>
        <div className="control-buttons">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`control-btn ${sortBy === opt.value ? 'active' : ''}`}
              onClick={() => onSortBy(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showNetwork}
            onChange={(e) => onShowNetwork(e.target.checked)}
          />
          <span>Network Layer</span>
        </label>
      </div>
    </div>
  );
}
