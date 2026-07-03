/**
 * App.tsx
 *
 * Main dashboard: assembles the uptime radar, control panel,
 * legend, details panel, and tooltip.
 */

import { useState, useCallback } from 'react';
import type { TimeRange, SortBy, TooltipData } from './types';
import { getNode } from './mockData';
import { UptimeRadar } from './UptimeRadar';
import { DetailsPanel } from './DetailsPanel';
import { ControlPanel } from './ControlPanel';
import { Legend } from './Legend';
import { Tooltip } from './Tooltip';
import './App.css';

export default function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [showNetwork, setShowNetwork] = useState(true);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const selectedNode = selectedNodeId ? getNode(selectedNodeId) ?? null : null;

  const handleClose = useCallback(() => setSelectedNodeId(null), []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="app-logo">◉</span> circtime
        </h1>
        <span className="app-subtitle">uptime radar</span>
      </header>

      <div className="app-body">
        <aside className="sidebar-left">
          <ControlPanel
            timeRange={timeRange}
            showNetwork={showNetwork}
            sortBy={sortBy}
            onTimeRange={setTimeRange}
            onShowNetwork={setShowNetwork}
            onSortBy={setSortBy}
          />
          <Legend />
        </aside>

        <main className="radar-container">
          <div className="radar-wrapper">
            <UptimeRadar
              sortBy={sortBy}
              showNetwork={showNetwork}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onTooltip={setTooltip}
            />
            <Tooltip data={tooltip} />
          </div>
        </main>

        {selectedNode && (
          <aside className="sidebar-right">
            <DetailsPanel
              node={selectedNode}
              timeRange={timeRange}
              onClose={handleClose}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
