import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SortBy, TimeRange, TooltipData } from './types';
import { getNode, getPageTitle, setActiveNodes } from './dataStore';
import { loadConfiguredNodes, refreshConfiguredNodes } from './configuredData';
import { readEmbedOptions, useEmbedTheme } from './embed';
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
const EMBED_OPTIONS = readEmbedOptions();

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

  const embed = EMBED_OPTIONS.embed;
  const theme = useEmbedTheme(EMBED_OPTIONS);

  useEffect(() => {
    let cancelled = false;

    function apply(nodes: Awaited<ReturnType<typeof loadConfiguredNodes>>) {
      if (!cancelled && nodes) {
        setActiveNodes(nodes);
        setDataVersion((version) => version + 1);
      }
    }

    loadConfiguredNodes()
      .then(apply)
      .catch((error) => {
        console.warn('Configured uptime data could not be loaded.', error);
      });

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      refreshConfiguredNodes()
        .then(apply)
        .catch((error) => {
          console.warn('Uptime data refresh failed.', error);
        });
    }, EMBED_OPTIONS.refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('circtime-embed', embed);
    root.dataset.theme = theme;
  }, [embed, theme]);

  useEffect(() => {
    if (embed) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen((open) => !open);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [embed]);

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    setTimeInspecting(id !== null);
  }, []);

  if (embed) {
    return (
      <div className="app-shell embed" aria-hidden="true">
        <main className="space-stage">
          <UptimeRadar3D
            dataVersion={dataVersion}
            sortBy={sortBy}
            showNetwork
            selectedNodeId={null}
            timeRange={timeRange}
            onSelectNode={handleSelectNode}
            onTooltip={setTooltip}
            onTimeRange={setTimeRange}
            onInspectingTime={setTimeInspecting}
            onTimeCursor={setTimeCursor}
            embed
            theme={theme}
            fit={EMBED_OPTIONS.fit}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="space-stage">
        <UptimeRadar3D
          dataVersion={dataVersion}
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
