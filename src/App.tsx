import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SortBy, TimeRange, TooltipData } from './types';
import { getNode, getPageTitle, setActiveNodes } from './dataStore';
import { loadConfiguredNodes } from './configuredData';
import { Tooltip } from './Tooltip';
import { AdminPanel } from './AdminPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { DomainProbe } from './DomainProbe';
import { UptimeRadar3D } from './UptimeRadar3D';
import './App.css';

const TIME_RANGES: TimeRange[] = ['1h', '24h', '7d', '30d'];
type TimeCursor = { index: number; total: number; label: string; timestamp?: number; phase: number; spacing: number; ticks: Array<{ key: string; label: string; offset: number }> };
const GIT_URL = 'https://github.com/Trance-0/circtime';

function TimeRuler({ active, cursor }: { active: boolean; cursor: TimeCursor }) {
  return (
    <div className={'time-ruler ' + (active ? 'visible' : '')} aria-hidden={!active}>
      <div className="time-ruler-scale">
        {Array.from({ length: 21 }, (_, index) => (
          <span
            key={index}
            className={index % 10 === 0 ? 'major' : index % 5 === 0 ? 'medium' : ''}
            style={{ top: String(50 + (index - 10) * (cursor.spacing / 10)) + '%' }}
          />
        ))}
        <div className="time-ruler-current">
          <i />
          <label>{cursor.label}</label>
        </div>
        {cursor.ticks.map((tick) => (
          <div
            key={tick.key}
            className="time-ruler-label"
            style={{ top: String(50 + (tick.offset - cursor.phase) * cursor.spacing) + '%' }}
          >
            <label>{tick.label}</label>
          </div>
        ))}
      </div>
    </div>
  );
}
export default function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [timeInspecting, setTimeInspecting] = useState(false);
  const [timeCursor, setTimeCursor] = useState<TimeCursor>({ index: 0, total: 1, label: 'now', phase: 0, spacing: 22, ticks: [] });

  const sortBy = 'name' satisfies SortBy;
  const pageTitle = useMemo(() => getPageTitle(), [dataVersion]);
  const selectedNode = useMemo(
    () => (selectedNodeId ? getNode(selectedNodeId) ?? null : null),
    [selectedNodeId, dataVersion],
  );

  useEffect(() => {
    let cancelled = false;

    loadConfiguredNodes()
      .then((nodes) => {
        if (!cancelled && nodes) {
          setActiveNodes(nodes);
          setDataVersion((version) => version + 1);
        }
      })
      .catch((error) => {
        console.warn('Using mock uptime data because configured data could not be loaded.', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen((open) => !open);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    setTimeInspecting(id !== null);
  }, []);

  return (
    <div className="app-shell">
      <main className="space-stage">
        <UptimeRadar3D
          sortBy={sortBy}
          showNetwork
          selectedNodeId={selectedNodeId}
          timeRange={timeRange}
          onSelectNode={handleSelectNode}
          onTooltip={setTooltip}
          onTimeRange={setTimeRange}
          onInspectingTime={setTimeInspecting}
          onTimeCursor={setTimeCursor}
        />
        <Tooltip
          data={tooltip}
          selectedNode={selectedNode}
          timestamp={timeInspecting ? timeCursor.timestamp : undefined}
        />
        <TimeRuler active={timeInspecting} cursor={timeCursor} />
        {selectedNode && (
          <>
            <AnalysisPanel
              dataVersion={dataVersion}
              node={selectedNode}
              timestamp={timeCursor.timestamp}
            />
            <div className="selection-pulse" />
          </>
        )}
      </main>

      {settingsOpen && (
        <div className="settings-scrim" onClick={() => setSettingsOpen(false)}>
          <section className="settings-menu" onClick={(event) => event.stopPropagation()}>
            <div className="settings-kicker">circtime</div>
            <h1>{pageTitle}</h1>
            <p>
              Minimal 3D service map for trance-0 infrastructure. Drag to rotate, scroll to zoom,
              hover for status, click a section to expand its service fan.
            </p>
            <a href={GIT_URL} target="_blank" rel="noreferrer">GitHub</a>
            <DomainProbe />
            <AdminPanel dataVersion={dataVersion} />
          </section>
        </div>
      )}
    </div>
  );
}