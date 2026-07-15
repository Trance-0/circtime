import { setConfigHash, setPageTitle, setRuntimeSettings } from './dataStore';
import type {
  HistoryEntry,
  InfrastructureNode,
  MonitorNode,
  NetworkNode,
  NodeStatus,
  ServiceNode,
} from './types';

interface ConfigNode {
  id: string;
  name: string;
  url: string;
  hue?: number;
  render_padding?: number;
  depends_on: string[];
  request?: Record<string, unknown>;
}

interface ConfigInfrastructure extends ConfigNode {
  hue: number;
  services: ConfigNode[];
  network: ConfigNode[];
}

interface CirctimeConfig {
  version: number;
  config_hash?: string;
  settings?: {
    page_title?: string;
    show_disk_outline?: boolean;
    max_timeout_ms?: number;
  };
  infrastructure: ConfigInfrastructure[];
}

interface HistoryFile {
  checks?: Record<string, HistoryEntry[]>;
}

function publicUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${fileName}`;
}

async function fetchJson<T>(fileName: string): Promise<T | null> {
  const response = await fetch(publicUrl(fileName), { cache: 'no-store' });
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

function historyFor(node: ConfigNode, history: HistoryFile | null): HistoryEntry[] {
  const entries = history?.checks?.[node.id];
  return entries && entries.length > 0 ? entries : [];
}

function computeUptime(history: HistoryEntry[]): number {
  const known = history.filter((entry) => entry.status !== 'unknown');
  if (known.length === 0) return 0;
  const up = known.filter((entry) => entry.status === 'up').length;
  return Math.round((up / known.length) * 10000) / 100;
}

function computeAvgLatency(history: HistoryEntry[]): number {
  const valid = history.filter((entry) => entry.latencyMs > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, entry) => sum + entry.latencyMs, 0) / valid.length);
}

function computeP95Latency(history: HistoryEntry[]): number {
  const valid = history
    .filter((entry) => entry.latencyMs > 0)
    .map((entry) => entry.latencyMs)
    .sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  return valid[Math.floor(valid.length * 0.95)] ?? valid[valid.length - 1];
}

function currentStatus(history: HistoryEntry[]): NodeStatus {
  return history[history.length - 1]?.status ?? 'unknown';
}

function baseFields(node: ConfigNode, history: HistoryEntry[]) {
  return {
    id: node.id,
    name: node.name,
    status: currentStatus(history),
    hue: node.hue,
    renderPadding: node.render_padding,
    url: node.url,
    uptimePercent: computeUptime(history),
    avgLatencyMs: computeAvgLatency(history),
    p95LatencyMs: computeP95Latency(history),
    lastCheckTime: history[history.length - 1]?.timestamp ?? Date.now(),
    history,
    dependsOn: node.depends_on ?? [],
  };
}

function buildNodes(config: CirctimeConfig, history: HistoryFile | null): MonitorNode[] {
  const nodes: MonitorNode[] = [];

  for (const infraConfig of config.infrastructure) {
    const infraHistory = historyFor(infraConfig, history);
    const services = infraConfig.services ?? [];
    const network = infraConfig.network ?? [];

    const infra: InfrastructureNode = {
      ...baseFields(infraConfig, infraHistory),
      type: 'infrastructure',
      hue: infraConfig.hue,
      services: services.map((service) => service.id),
      networkNodes: network.map((networkNode) => networkNode.id),
    };
    nodes.push(infra);

    for (const serviceConfig of services) {
      const serviceHistory = historyFor(serviceConfig, history);
      const service: ServiceNode = {
        ...baseFields(serviceConfig, serviceHistory),
        type: 'service',
        infrastructureId: infraConfig.id,
      };
      nodes.push(service);
    }

    for (const networkConfig of network) {
      const networkHistory = historyFor(networkConfig, history);
      const networkNode: NetworkNode = {
        ...baseFields(networkConfig, networkHistory),
        type: 'network',
        infrastructureId: infraConfig.id,
      };
      nodes.push(networkNode);
    }
  }

  return nodes;
}

export async function loadConfiguredNodes(): Promise<MonitorNode[] | null> {
  const config = await fetchJson<CirctimeConfig>('circtime-config.json');
  if (!config?.infrastructure?.length) return null;

  setConfigHash(config.config_hash ?? 'configured-data');
  setPageTitle(config.settings?.page_title ?? 'circtime');
  setRuntimeSettings({
    showDiskOutline: config.settings?.show_disk_outline ?? true,
    maxTimeoutMs: Math.max(1, config.settings?.max_timeout_ms ?? 5000),
  });
  document.title = config.settings?.page_title ?? 'circtime';
  const history = await fetchJson<HistoryFile>('uptime-history.json');
  return buildNodes(config, history);
}
