import { allNodes as mockNodes } from './mockData';
import type { InfrastructureNode, MonitorNode, NetworkNode, ServiceNode } from './types';

let activeNodes: MonitorNode[] = mockNodes;
let activeConfigHash = 'mock-config';
let activePageTitle = 'circtime';

export function setActiveNodes(nodes: MonitorNode[]) {
  activeNodes = nodes.length > 0 ? nodes : mockNodes;
}

export function getAllNodes(): MonitorNode[] {
  return activeNodes;
}

export function setConfigHash(hash: string) {
  activeConfigHash = hash || 'mock-config';
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
