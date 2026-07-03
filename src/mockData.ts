/**
 * mockData.ts
 *
 * Generates a realistic mock dataset for the uptime radar.
 * Includes infrastructure providers, services, network nodes,
 * and fake check history for each.
 *
 * Replace this module with real API calls later.
 */

import type {
  InfrastructureNode,
  ServiceNode,
  NetworkNode,
  MonitorNode,
  HistoryEntry,
  NodeStatus,
} from './types';

// ── Helpers ─────────────────────────────────────────────────────────

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Seeded-ish pseudo-random for reproducible data */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function generateHistory(
  baseStatus: NodeStatus,
  degradedChance: number,
  downChance: number,
  count: number,
  intervalMs: number,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    let status: NodeStatus = baseStatus;
    if (r < downChance) status = 'down';
    else if (r < downChance + degradedChance) status = 'degraded';
    else status = 'up';

    const latency =
      status === 'down'
        ? 0
        : status === 'degraded'
          ? 800 + rand() * 4000
          : 20 + rand() * 200;

    entries.push({
      timestamp: NOW - i * intervalMs,
      status,
      latencyMs: Math.round(latency),
      statusCode: status === 'down' ? 0 : status === 'degraded' ? 503 : 200,
      message:
        status === 'down'
          ? 'Connection refused'
          : status === 'degraded'
            ? 'High latency detected'
            : 'OK',
    });
  }
  return entries.reverse(); // oldest first
}

function computeUptime(history: HistoryEntry[]): number {
  if (history.length === 0) return 100;
  const up = history.filter((h) => h.status === 'up').length;
  return Math.round((up / history.length) * 10000) / 100;
}

function computeAvgLatency(history: HistoryEntry[]): number {
  const valid = history.filter((h) => h.latencyMs > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((s, h) => s + h.latencyMs, 0) / valid.length);
}

function computeP95Latency(history: HistoryEntry[]): number {
  const valid = history.filter((h) => h.latencyMs > 0).map((h) => h.latencyMs);
  if (valid.length === 0) return 0;
  valid.sort((a, b) => a - b);
  return valid[Math.floor(valid.length * 0.95)] ?? valid[valid.length - 1];
}

// ── Build infrastructure ────────────────────────────────────────────

interface InfraDef {
  id: string;
  name: string;
  hue: number;
  services: { id: string; name: string; deps?: string[] }[];
  network?: { id: string; name: string; deps?: string[] }[];
  degradedChance?: number;
  downChance?: number;
}

const infraDefs: InfraDef[] = [
  {
    id: 'github-pages',
    name: 'GitHub Pages',
    hue: 210,  // blue
    services: [
      { id: 'gh-docs', name: 'Personal Docs Site' },
      { id: 'gh-readme', name: 'Project Readme Mirror' },
    ],
    degradedChance: 0.02,
    downChance: 0.005,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    hue: 35,   // orange
    services: [
      { id: 'cf-dns', name: 'DNS' },
    ],
    network: [
      { id: 'cf-tunnel', name: 'Cloudflare Tunnel', deps: ['cf-dns'] },
      { id: 'cf-proxy', name: 'Reverse Proxy', deps: ['cf-dns', 'cf-tunnel'] },
    ],
    degradedChance: 0.01,
    downChance: 0.002,
  },
  {
    id: 'vercel',
    name: 'Vercel',
    hue: 280,  // purple
    services: [
      { id: 'vr-frontend', name: 'Frontend App' },
      { id: 'vr-api', name: 'API Route', deps: ['vr-frontend'] },
    ],
    degradedChance: 0.03,
    downChance: 0.01,
  },
  {
    id: 'machine-a',
    name: 'Self-hosted Machine A',
    hue: 150,  // green
    services: [
      { id: 'ma-nextcloud', name: 'Nextcloud' },
      { id: 'ma-minecraft', name: 'Minecraft Server' },
      { id: 'ma-postgres', name: 'PostgreSQL', deps: ['ma-nextcloud'] },
    ],
    network: [
      { id: 'ma-nginx', name: 'Nginx Reverse Proxy', deps: ['ma-nextcloud'] },
    ],
    degradedChance: 0.05,
    downChance: 0.02,
  },
  {
    id: 'machine-b',
    name: 'Self-hosted Machine B',
    hue: 0,    // red
    services: [
      { id: 'mb-gitea', name: 'Gitea' },
      { id: 'mb-jenkins', name: 'Jenkins', deps: ['mb-gitea'] },
      { id: 'mb-registry', name: 'Docker Registry' },
    ],
    degradedChance: 0.06,
    downChance: 0.03,
  },
];

// ── Generate all nodes ──────────────────────────────────────────────

function buildNodes(): MonitorNode[] {
  const nodes: MonitorNode[] = [];
  const checkCount = 720;        // ~30 days at 1h intervals
  const checkInterval = HOUR;

  for (const def of infraDefs) {
    const dChance = def.degradedChance ?? 0.03;
    const downChance = def.downChance ?? 0.01;

    // Infrastructure node history
    const infraHistory = generateHistory('up', dChance * 0.3, downChance * 0.2, checkCount, checkInterval);
    const infraStatus = infraHistory[infraHistory.length - 1].status;

    const serviceIds = def.services.map((s) => s.id);
    const networkIds = (def.network ?? []).map((n) => n.id);

    const infra: InfrastructureNode = {
      id: def.id,
      name: def.name,
      type: 'infrastructure',
      hue: def.hue,
      status: infraStatus,
      url: '',
      uptimePercent: computeUptime(infraHistory),
      avgLatencyMs: computeAvgLatency(infraHistory),
      p95LatencyMs: computeP95Latency(infraHistory),
      lastCheckTime: NOW,
      history: infraHistory,
      services: serviceIds,
      networkNodes: networkIds,
      dependsOn: [],
    };
    nodes.push(infra);

    // Service nodes
    for (const svc of def.services) {
      const svcHistory = generateHistory('up', dChance, downChance, checkCount, checkInterval);
      const svcNode: ServiceNode = {
        id: svc.id,
        name: svc.name,
        type: 'service',
        infrastructureId: def.id,
        status: svcHistory[svcHistory.length - 1].status,
        url: '',
        uptimePercent: computeUptime(svcHistory),
        avgLatencyMs: computeAvgLatency(svcHistory),
        p95LatencyMs: computeP95Latency(svcHistory),
        lastCheckTime: NOW,
        history: svcHistory,
        dependsOn: svc.deps ?? [],
      };
      nodes.push(svcNode);
    }

    // Network nodes
    for (const net of def.network ?? []) {
      const netHistory = generateHistory('up', dChance * 0.5, downChance * 0.3, checkCount, checkInterval);
      const netNode: NetworkNode = {
        id: net.id,
        name: net.name,
        type: 'network',
        infrastructureId: def.id,
        status: netHistory[netHistory.length - 1].status,
        url: '',
        uptimePercent: computeUptime(netHistory),
        avgLatencyMs: computeAvgLatency(netHistory),
        p95LatencyMs: computeP95Latency(netHistory),
        lastCheckTime: NOW,
        history: netHistory,
        dependsOn: net.deps ?? [],
      };
      nodes.push(netNode);
    }
  }

  // Force a couple interesting states for visual variety
  const minecraft = nodes.find((n) => n.id === 'ma-minecraft');
  if (minecraft) {
    minecraft.status = 'down';
    minecraft.uptimePercent = 87.5;
    // Inject some recent downs into history
    for (let i = minecraft.history.length - 1; i >= minecraft.history.length - 5 && i >= 0; i--) {
      minecraft.history[i].status = 'down';
      minecraft.history[i].latencyMs = 0;
      minecraft.history[i].statusCode = 0;
      minecraft.history[i].message = 'Connection refused — server crashed';
    }
  }

  const jenkins = nodes.find((n) => n.id === 'mb-jenkins');
  if (jenkins) {
    jenkins.status = 'degraded';
    jenkins.uptimePercent = 94.3;
  }

  return nodes;
}

export const allNodes: MonitorNode[] = buildNodes();

/** Lookup helpers */
export function getNode(id: string): MonitorNode | undefined {
  return allNodes.find((n) => n.id === id);
}

export function getInfrastructures(): InfrastructureNode[] {
  return allNodes.filter((n): n is InfrastructureNode => n.type === 'infrastructure');
}

export function getServicesFor(infraId: string): ServiceNode[] {
  return allNodes.filter(
    (n): n is ServiceNode => n.type === 'service' && n.infrastructureId === infraId,
  );
}

export function getNetworkFor(infraId: string): NetworkNode[] {
  return allNodes.filter(
    (n): n is NetworkNode => n.type === 'network' && n.infrastructureId === infraId,
  );
}

/** Get the infrastructure hue for any node */
export function getHueFor(node: MonitorNode): number {
  if (node.type === 'infrastructure') return node.hue;
  const infra = allNodes.find(
    (n): n is InfrastructureNode =>
      n.type === 'infrastructure' && n.id === (node as ServiceNode | NetworkNode).infrastructureId,
  );
  return infra?.hue ?? 0;
}
