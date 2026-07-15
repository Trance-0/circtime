import type { InfrastructureNode, MonitorNode, NetworkNode, ServiceNode } from './types';

export interface RuntimeSettings {
  showDiskOutline: boolean;
  maxTimeoutMs: number;
}

let activeNodes: MonitorNode[] = [];
let activeConfigHash = 'empty-config';
let activePageTitle = 'circtime';
let activeSettings: RuntimeSettings = {
  showDiskOutline: true,
  maxTimeoutMs: 5000,
};

export function setActiveNodes(nodes: MonitorNode[]) {
  activeNodes = nodes;
}

export function getAllNodes(): MonitorNode[] {
  return activeNodes;
}

export function setConfigHash(hash: string) {
  activeConfigHash = hash || 'configured-data';
}

export function getConfigHash(): string {
  return activeConfigHash;
}
export function setPageTitle(title: string) {
  activePageTitle = title || 'circtime';
}

export function getPageTitle(): string {
  return activePageTitle;
}

export function setRuntimeSettings(settings: Partial<RuntimeSettings>) {
  activeSettings = { ...activeSettings, ...settings };
}

export function getRuntimeSettings(): RuntimeSettings {
  return activeSettings;
}

export function getNode(id: string): MonitorNode | undefined {
  return activeNodes.find((node) => node.id === id);
}

export function getInfrastructures(): InfrastructureNode[] {
  return activeNodes.filter((node): node is InfrastructureNode => node.type === 'infrastructure');
}

export function getServicesFor(infraId: string): ServiceNode[] {
  return activeNodes.filter(
    (node): node is ServiceNode => node.type === 'service' && node.infrastructureId === infraId,
  );
}

export function getNetworkFor(infraId: string): NetworkNode[] {
  return activeNodes.filter(
    (node): node is NetworkNode => node.type === 'network' && node.infrastructureId === infraId,
  );
}

export function getHueFor(node: MonitorNode): number {
  if (node.type === 'infrastructure') return node.hue;
  const infra = getInfrastructures().find((candidate) => candidate.id === node.infrastructureId);
  return infra?.hue ?? 0;
}
