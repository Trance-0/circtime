import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { monochromeColor } from './statusColor';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HistoryEntry, MonitorNode, SortBy, TimeRange, TooltipData } from './types';
import {
  getConfigHash,
  getInfrastructures,
  getNetworkFor,
  getNode,
  getRuntimeSettings,
  getServicesFor,
} from './dataStore';

export interface Props {
  dataVersion: number;
  sortBy: SortBy;
  showNetwork: boolean;
  selectedNodeId: string | null;
  timeRange: TimeRange;
  onSelectNode: (id: string | null) => void;
  onTooltip: (data: TooltipData | null) => void;
  onTimeRange: (range: TimeRange) => void;
  onInspectingTime: (active: boolean) => void;
  onTimeCursor: (cursor: { index: number; total: number; label: string; timestamp?: number; phase: number; spacing: number; ticks: Array<{ key: string; label: string; offset: number }> }) => void;
  /** Background-widget mode: transparent canvas, no input, radar fitted to the viewport. */
  embed?: boolean;
  theme?: 'light' | 'dark';
  fit?: 'contain' | 'cover';
  monochrome?: boolean;
}

export const EMBED_MARGIN = 1.04;

export interface SegmentDef {
  node: MonitorNode;
  ring: 'infrastructure' | 'service' | 'network';
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  hue: number;
}

export const TIME_RANGES: TimeRange[] = ['1h', '24h', '7d', '30d'];
export const SELECTED_HISTORY_SAMPLES = 560;
export const TOTAL_HISTORY_SAMPLES = 72;
export const HISTORY_WINDOW_RADIUS = 10;
export const MIN_TIME_STEP_MS = 60 * 1000;
export const MAX_TIME_STEP_MS = 366 * 24 * 60 * 60 * 1000;
export const DEFAULT_TIME_STEP_MS = 24 * 60 * 60 * 1000;
export const SCROLL_ZOOM_BASE = 1.22;
export const DEFAULT_CAMERA_Z = 6.1;
export const DEFAULT_ROTATION_X = 0;
export const HISTORY_LAYER_GAP = 0.09;
export const HISTORY_Z_PRESENT = -0.12;
export const LIGHTNESS_MIN = 0.1;
export const LIGHTNESS_MAX = 0.9;
export const INNER_RING_START = 0.68;
export const RING_GAP = 0.1;
export const RING_RADIAL_TRAVEL = 0.08;
export const INFRASTRUCTURE_THICKNESS_BASE = 0.42;
export const SERVICE_THICKNESS_BASE = 0.41;
export const NETWORK_THICKNESS_BASE = 0.18;
export const MAX_RADIAL_SCALE = 0.42 + 5 * 0.15 + 0.12;
export const INFRASTRUCTURE_BAND_WIDTH = INFRASTRUCTURE_THICKNESS_BASE * MAX_RADIAL_SCALE + RING_RADIAL_TRAVEL;
export const SERVICE_BAND_START = INNER_RING_START + INFRASTRUCTURE_BAND_WIDTH + RING_GAP;
export const SERVICE_BAND_WIDTH = SERVICE_THICKNESS_BASE * MAX_RADIAL_SCALE + RING_RADIAL_TRAVEL;
export const NETWORK_BAND_START = SERVICE_BAND_START + SERVICE_BAND_WIDTH + RING_GAP;
export const NETWORK_BAND_WIDTH = NETWORK_THICKNESS_BASE * MAX_RADIAL_SCALE + RING_RADIAL_TRAVEL;
export const FOCUSED_PLANAR_SCALE = 1.04;
export const FOCUSED_DEPTH_SCALE = 1.45;
export const FOCUS_EASING = 0.12;
export const RESOLUTION_STEPS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  2 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  90 * 24 * 60 * 60 * 1000,
  366 * 24 * 60 * 60 * 1000,
];

export function latencyLightness(latencyMs: number, status: MonitorNode['status'], maxTimeoutMs: number): number {
  if (status === 'unknown') return 0.28;
  if (status === 'down') return LIGHTNESS_MIN;
  const ratio = THREE.MathUtils.clamp(Math.max(latencyMs, 0) / Math.max(maxTimeoutMs, 1), 0, 1);
  return THREE.MathUtils.lerp(LIGHTNESS_MAX, LIGHTNESS_MIN, ratio);
}

export function colorFor(node: MonitorNode, hue: number, maxTimeoutMs: number, monochrome = false): THREE.Color {
  if (monochrome) return new THREE.Color(monochromeColor(node));
  const saturation = node.status === 'unknown'
    ? 0.08
    : THREE.MathUtils.lerp(0.18, 0.9, THREE.MathUtils.clamp(node.uptimePercent / 100, 0, 1));
  const latency = node.history[node.history.length - 1]?.latencyMs ?? node.avgLatencyMs;
  const lightness = latencyLightness(latency, node.status, maxTimeoutMs);
  return new THREE.Color().setHSL(hue / 360, saturation, lightness);
}

export function historyColor(entry: HistoryEntry, hue: number, maxTimeoutMs: number): THREE.Color {
  const saturation = entry.status === 'unknown' ? 0.08 : entry.status === 'down' ? 0.24 : 0.72;
  return new THREE.Color().setHSL(
    hue / 360,
    saturation,
    latencyLightness(entry.latencyMs, entry.status, maxTimeoutMs),
  );
}

export function annularShape(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
  const shape = new THREE.Shape();
  const steps = Math.max(16, Math.ceil((endAngle - startAngle) * 36));

  for (let i = 0; i <= steps; i += 1) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps;
    const x = Math.cos(t) * outerRadius;
    const y = Math.sin(t) * outerRadius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }

  for (let i = steps; i >= 0; i -= 1) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps;
    shape.lineTo(Math.cos(t) * innerRadius, Math.sin(t) * innerRadius);
  }

  shape.closePath();
  return shape;
}

export function clampRenderPadding(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return THREE.MathUtils.clamp(Math.round(value ?? 0), 1, 5);
}

export function stableRenderPadding(node: MonitorNode): number {
  const fixed = clampRenderPadding(node.renderPadding);
  if (fixed !== undefined) return fixed;
  return 1 + Math.floor(stableUnit(node, 'render-padding') * 5);
}

export function renderWeight(node: MonitorNode): number {
  const size = stableRenderPadding(node);
  return [0, 0.42, 0.72, 1.08, 1.58, 2.24][size];
}

export function stableUnit(node: MonitorNode, salt: string): number {
  return seededRandom(seedFromHash(`${getConfigHash()}:${node.id}:${salt}`))();
}

export function angularInset(node: MonitorNode): number {
  return 0.006 + stableUnit(node, 'angle-inset') * 0.008;
}

export function radialThickness(node: MonitorNode, base: number): number {
  const size = stableRenderPadding(node);
  return base * (0.42 + size * 0.15 + stableUnit(node, 'width') * 0.12);
}

export function aggregateServiceSize(infrastructureId: string, networkNode?: MonitorNode): number {
  const services = getServicesFor(infrastructureId);
  const dependentServices = networkNode
    ? services.filter((service) => service.dependsOn.includes(networkNode.id))
    : services;
  const source = dependentServices.length > 0 ? dependentServices : services;
  if (source.length === 0) return 3;
  return source.reduce((sum, service) => sum + stableRenderPadding(service), 0) / source.length;
}

export function derivedRadialThickness(node: MonitorNode, base: number): number {
  if (node.type === 'service' || clampRenderPadding(node.renderPadding) !== undefined) {
    return radialThickness(node, base);
  }
  const size = aggregateServiceSize(
    node.type === 'infrastructure' ? node.id : node.infrastructureId,
    node.type === 'network' ? node : undefined,
  );
  return base * (0.42 + size * 0.15 + stableUnit(node, 'width') * 0.12);
}

export function radialBounds(node: MonitorNode, base: number, bandStart: number, bandWidth: number) {
  const thickness = Math.min(derivedRadialThickness(node, base), bandWidth);
  const availableTravel = Math.max(0, bandWidth - thickness);
  const innerRadius = bandStart + stableUnit(node, 'radius') * availableTravel;
  return { innerRadius, outerRadius: innerRadius + thickness };
}

export function networkRenderWeight(node: MonitorNode, infrastructureId: string, siblingCount: number): number {
  const fixed = clampRenderPadding(node.renderPadding);
  if (fixed !== undefined) return renderWeight(node);
  const services = getServicesFor(infrastructureId);
  const dependents = services.filter((service) => service.dependsOn.includes(node.id));
  if (dependents.length > 0) return dependents.reduce((sum, service) => sum + renderWeight(service), 0);
  return Math.max(0.42, services.reduce((sum, service) => sum + renderWeight(service), 0) / Math.max(siblingCount, 1));
}

export function insetAngles(node: MonitorNode, start: number, end: number) {
  const inset = Math.min(angularInset(node), Math.max(0, (end - start) * 0.22));
  return { startAngle: start + inset, endAngle: end - inset };
}

export function computeSegments(sortBy: SortBy, showNetwork: boolean): SegmentDef[] {
  const infras = [...getInfrastructures()];
  if (sortBy === 'name') infras.sort((a, b) => a.name.localeCompare(b.name));
  if (sortBy === 'uptime') infras.sort((a, b) => a.uptimePercent - b.uptimePercent);
  if (sortBy === 'status') {
    const order: Record<string, number> = { down: 0, degraded: 1, unknown: 2, up: 3 };
    infras.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
  }

  const globalServices = getInfrastructures()
    .flatMap((infra) => getServicesFor(infra.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const serviceHues = new Map(
    globalServices.map((service, index) => [service.id, Math.round((index / Math.max(globalServices.length, 1)) * 360)]),
  );
  const weights = infras.map((infra) => {
    const services = getServicesFor(infra.id);
    const network = showNetwork ? getNetworkFor(infra.id) : [];
    const serviceWeight = services.reduce((sum, service) => sum + renderWeight(service), 0);
    const networkWeight = network.reduce(
      (sum, networkNode) => sum + networkRenderWeight(networkNode, infra.id, network.length),
      0,
    );
    const base = Math.max(0.6, serviceWeight + networkWeight * 0.18);
    return base;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const gap = 0.018;
  const usable = Math.PI * 2 - gap * infras.length;
  const segments: SegmentDef[] = [];
  let cursor = -Math.PI / 2;

  for (let i = 0; i < infras.length; i += 1) {
    const infra = infras[i];
    const span = (weights[i] / totalWeight) * usable;
    const start = cursor;
    const end = cursor + span;
    const infraAngles = insetAngles(infra, start, end);
    // Every node varies inside its ring's reserved envelope. The envelopes use
    // the maximum possible size/width scale, so adjacent node types cannot overlap.
    const infraBounds = radialBounds(
      infra,
      INFRASTRUCTURE_THICKNESS_BASE,
      INNER_RING_START,
      INFRASTRUCTURE_BAND_WIDTH,
    );
    segments.push({
      node: infra,
      ring: 'infrastructure',
      innerRadius: infraBounds.innerRadius,
      outerRadius: infraBounds.outerRadius,
      startAngle: infraAngles.startAngle,
      endAngle: infraAngles.endAngle,
      hue: infra.hue ?? 0,
    });

    const services = getServicesFor(infra.id);
    const serviceWeight = services.reduce((sum, service) => sum + renderWeight(service), 0);
    let serviceAngle = start;
    services.forEach((service) => {
      const hue = serviceHues.get(service.id) ?? 0;
      const serviceSpan = serviceWeight > 0 ? span * (renderWeight(service) / serviceWeight) : span;
      const serviceStart = serviceAngle;
      const serviceEnd = serviceStart + serviceSpan;

      serviceAngle = serviceEnd;
      const serviceAngles = insetAngles(service, serviceStart, serviceEnd);
      const serviceBounds = radialBounds(
        service,
        SERVICE_THICKNESS_BASE,
        SERVICE_BAND_START,
        SERVICE_BAND_WIDTH,
      );
      segments.push({
        node: service,
        ring: 'service',
        innerRadius: serviceBounds.innerRadius,
        outerRadius: serviceBounds.outerRadius,
        startAngle: serviceAngles.startAngle,
        endAngle: serviceAngles.endAngle,
        hue,
      });
    });

    const network = showNetwork ? getNetworkFor(infra.id) : [];
    const networkWeight = network.reduce(
      (sum, networkNode) => sum + networkRenderWeight(networkNode, infra.id, network.length),
      0,
    );
    let networkAngle = start;
    network.forEach((networkNode) => {
      const networkSpan = networkWeight > 0
        ? span * (networkRenderWeight(networkNode, infra.id, network.length) / networkWeight)
        : span;
      const networkStart = networkAngle;
      const networkEnd = networkStart + networkSpan;
      networkAngle = networkEnd;
      const networkAngles = insetAngles(networkNode, networkStart, networkEnd);
      const networkBounds = radialBounds(
        networkNode,
        NETWORK_THICKNESS_BASE,
        NETWORK_BAND_START,
        NETWORK_BAND_WIDTH,
      );
      segments.push({
        node: networkNode,
        ring: 'network',
        innerRadius: networkBounds.innerRadius,
        outerRadius: networkBounds.outerRadius,
        startAngle: networkAngles.startAngle,
        endAngle: networkAngles.endAngle,
        hue: networkNode.hue ?? infra.hue ?? 0,
      });
    });

    cursor = end + gap;
  }

  return segments;
}

export function seedFromHash(hash: string): number {
  return hash.split('').reduce((seed, char) => ((seed * 33) ^ char.charCodeAt(0)) >>> 0, 2166136261);
}

export function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function clampTimeStep(stepMs: number): number {
  return THREE.MathUtils.clamp(stepMs, MIN_TIME_STEP_MS, MAX_TIME_STEP_MS);
}

export function nearestResolutionStep(stepMs: number): number {
  const clamped = clampTimeStep(stepMs);
  return RESOLUTION_STEPS_MS.reduce((nearest, candidate) =>
    Math.abs(Math.log(candidate / clamped)) < Math.abs(Math.log(nearest / clamped)) ? candidate : nearest,
  RESOLUTION_STEPS_MS[0]);
}

export function sampleHistoryAtResolution(history: HistoryEntry[], stepMs: number, limit: number): HistoryEntry[] {
  if (history.length === 0) return [];
  const resolution = nearestResolutionStep(stepMs);
  const buckets = new Map<number, HistoryEntry>();
  for (const entry of history) {
    buckets.set(Math.floor(entry.timestamp / resolution), entry);
  }
  const sampled = [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
  return sampled.slice(-Math.max(limit, 1));
}

export function historyLayerZ(index: number, total: number, spacing = HISTORY_LAYER_GAP): number {
  return HISTORY_Z_PRESENT - Math.max(total - 1 - index, 0) * spacing;
}

export function nearestHistoryEntry(history: HistoryEntry[], timestamp: number): HistoryEntry | undefined {
  if (history.length === 0) return undefined;
  let low = 0;
  let high = history.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (history[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  const before = Math.max(0, low - 1);
  return Math.abs(history[before].timestamp - timestamp) <= Math.abs(history[low].timestamp - timestamp)
    ? history[before]
    : history[low];
}

export function applyGeometryColor(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function timeStepToLayerDistance(stepMs: number): number {
  const normalized = Math.log(clampTimeStep(stepMs) / MIN_TIME_STEP_MS) / Math.log(MAX_TIME_STEP_MS / MIN_TIME_STEP_MS);
  return THREE.MathUtils.lerp(2.85, 0.42, THREE.MathUtils.clamp(normalized, 0, 1));
}

export function rulerSpacingPercent(stepMs: number): number {
  const normalized = Math.log(clampTimeStep(stepMs) / MIN_TIME_STEP_MS) / Math.log(MAX_TIME_STEP_MS / MIN_TIME_STEP_MS);
  return THREE.MathUtils.lerp(30, 9, THREE.MathUtils.clamp(normalized, 0, 1));
}

export function formatRulerTime(timestamp: number | undefined, stepMs: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (stepMs < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const base = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const year = date.getFullYear();
  return year === new Date().getFullYear() ? base : `${base} ${year}`;
}

export function disposeRenderable(object: THREE.Object3D) {
  const renderable = object as THREE.Object3D & {
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  };
  renderable.geometry?.dispose();
  if (Array.isArray(renderable.material)) renderable.material.forEach((material) => material.dispose());
  else renderable.material?.dispose();
}

export function makeStarfield(hash: string): THREE.Points {
  const rand = seededRandom(seedFromHash(`${hash}:stars`));
  const count = 2400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    const clustered = rand() < 0.62;
    const arm = rand() < 0.72 ? 1 : -1;
    const radius = clustered ? 4.2 + Math.pow(rand(), 0.62) * 10.8 : 7 + rand() * 12;
    const spiral = radius * 0.34 * arm;
    const angle = clustered
      ? spiral + (rand() - 0.5) * (0.38 + radius * 0.035)
      : rand() * Math.PI * 2;
    const band = clustered ? (rand() - 0.5) * (0.22 + rand() * 0.9) : (rand() - 0.5) * 8;
    const vertical = band + Math.sin(radius * 0.45 + angle) * 0.25;
    const x = Math.cos(angle) * radius + (rand() - 0.5) * 0.9;
    const y = Math.sin(angle) * radius + (rand() - 0.5) * 0.9;
    const z = vertical + (rand() - 0.5) * (clustered ? 0.5 : 4.5);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const hue = rand() < 0.72 ? 0.6 + rand() * 0.08 : 0.08 + rand() * 0.08;
    const saturation = clustered ? 0.18 + rand() * 0.32 : 0.05 + rand() * 0.16;
    const lightness = clustered ? 0.48 + rand() * 0.42 : 0.32 + rand() * 0.36;
    color.setHSL(hue, saturation, lightness);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.026,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

