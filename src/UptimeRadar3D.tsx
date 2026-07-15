import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
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

interface Props {
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
}

interface SegmentDef {
  node: MonitorNode;
  ring: 'infrastructure' | 'service' | 'network';
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  hue: number;
}

const TIME_RANGES: TimeRange[] = ['1h', '24h', '7d', '30d'];
const SELECTED_HISTORY_SAMPLES = 560;
const TOTAL_HISTORY_SAMPLES = 72;
const HISTORY_WINDOW_RADIUS = 10;
const MIN_TIME_STEP_MS = 60 * 1000;
const MAX_TIME_STEP_MS = 366 * 24 * 60 * 60 * 1000;
const DEFAULT_TIME_STEP_MS = 24 * 60 * 60 * 1000;
const SCROLL_ZOOM_BASE = 1.22;
const DEFAULT_CAMERA_Z = 6.1;
const DEFAULT_ROTATION_X = 0;
const HISTORY_LAYER_GAP = 0.09;
const HISTORY_Z_PRESENT = -0.12;
const LIGHTNESS_MIN = 0.1;
const LIGHTNESS_MAX = 0.9;
const INNER_RING_START = 0.68;
const RING_GAP = 0.1;
const RING_RADIAL_TRAVEL = 0.08;
const INFRASTRUCTURE_THICKNESS_BASE = 0.42;
const SERVICE_THICKNESS_BASE = 0.41;
const NETWORK_THICKNESS_BASE = 0.18;
const MAX_RADIAL_SCALE = 0.42 + 5 * 0.15 + 0.12;
const INFRASTRUCTURE_BAND_WIDTH = INFRASTRUCTURE_THICKNESS_BASE * MAX_RADIAL_SCALE + RING_RADIAL_TRAVEL;
const SERVICE_BAND_START = INNER_RING_START + INFRASTRUCTURE_BAND_WIDTH + RING_GAP;
const SERVICE_BAND_WIDTH = SERVICE_THICKNESS_BASE * MAX_RADIAL_SCALE + RING_RADIAL_TRAVEL;
const NETWORK_BAND_START = SERVICE_BAND_START + SERVICE_BAND_WIDTH + RING_GAP;
const NETWORK_BAND_WIDTH = NETWORK_THICKNESS_BASE * MAX_RADIAL_SCALE + RING_RADIAL_TRAVEL;
const FOCUSED_PLANAR_SCALE = 1.04;
const FOCUSED_DEPTH_SCALE = 1.45;
const FOCUS_EASING = 0.12;
const RESOLUTION_STEPS_MS = [
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

function latencyLightness(latencyMs: number, status: MonitorNode['status'], maxTimeoutMs: number): number {
  if (status === 'unknown') return 0.28;
  if (status === 'down') return LIGHTNESS_MIN;
  const ratio = THREE.MathUtils.clamp(Math.max(latencyMs, 0) / Math.max(maxTimeoutMs, 1), 0, 1);
  return THREE.MathUtils.lerp(LIGHTNESS_MAX, LIGHTNESS_MIN, ratio);
}

function colorFor(node: MonitorNode, hue: number, maxTimeoutMs: number): THREE.Color {
  const saturation = node.status === 'unknown'
    ? 0.08
    : THREE.MathUtils.lerp(0.18, 0.9, THREE.MathUtils.clamp(node.uptimePercent / 100, 0, 1));
  const latency = node.history[node.history.length - 1]?.latencyMs ?? node.avgLatencyMs;
  const lightness = latencyLightness(latency, node.status, maxTimeoutMs);
  return new THREE.Color().setHSL(hue / 360, saturation, lightness);
}

function historyColor(entry: HistoryEntry, hue: number, maxTimeoutMs: number): THREE.Color {
  const saturation = entry.status === 'unknown' ? 0.08 : entry.status === 'down' ? 0.24 : 0.72;
  return new THREE.Color().setHSL(
    hue / 360,
    saturation,
    latencyLightness(entry.latencyMs, entry.status, maxTimeoutMs),
  );
}

function annularShape(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
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

function clampRenderPadding(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return THREE.MathUtils.clamp(Math.round(value ?? 0), 1, 5);
}

function stableRenderPadding(node: MonitorNode): number {
  const fixed = clampRenderPadding(node.renderPadding);
  if (fixed !== undefined) return fixed;
  return 1 + Math.floor(stableUnit(node, 'render-padding') * 5);
}

function renderWeight(node: MonitorNode): number {
  const size = stableRenderPadding(node);
  return [0, 0.42, 0.72, 1.08, 1.58, 2.24][size];
}

function stableUnit(node: MonitorNode, salt: string): number {
  return seededRandom(seedFromHash(`${getConfigHash()}:${node.id}:${salt}`))();
}

function angularInset(node: MonitorNode): number {
  return 0.006 + stableUnit(node, 'angle-inset') * 0.008;
}

function radialThickness(node: MonitorNode, base: number): number {
  const size = stableRenderPadding(node);
  return base * (0.42 + size * 0.15 + stableUnit(node, 'width') * 0.12);
}

function aggregateServiceSize(infrastructureId: string, networkNode?: MonitorNode): number {
  const services = getServicesFor(infrastructureId);
  const dependentServices = networkNode
    ? services.filter((service) => service.dependsOn.includes(networkNode.id))
    : services;
  const source = dependentServices.length > 0 ? dependentServices : services;
  if (source.length === 0) return 3;
  return source.reduce((sum, service) => sum + stableRenderPadding(service), 0) / source.length;
}

function derivedRadialThickness(node: MonitorNode, base: number): number {
  if (node.type === 'service' || clampRenderPadding(node.renderPadding) !== undefined) {
    return radialThickness(node, base);
  }
  const size = aggregateServiceSize(
    node.type === 'infrastructure' ? node.id : node.infrastructureId,
    node.type === 'network' ? node : undefined,
  );
  return base * (0.42 + size * 0.15 + stableUnit(node, 'width') * 0.12);
}

function radialBounds(node: MonitorNode, base: number, bandStart: number, bandWidth: number) {
  const thickness = Math.min(derivedRadialThickness(node, base), bandWidth);
  const availableTravel = Math.max(0, bandWidth - thickness);
  const innerRadius = bandStart + stableUnit(node, 'radius') * availableTravel;
  return { innerRadius, outerRadius: innerRadius + thickness };
}

function networkRenderWeight(node: MonitorNode, infrastructureId: string, siblingCount: number): number {
  const fixed = clampRenderPadding(node.renderPadding);
  if (fixed !== undefined) return renderWeight(node);
  const services = getServicesFor(infrastructureId);
  const dependents = services.filter((service) => service.dependsOn.includes(node.id));
  if (dependents.length > 0) return dependents.reduce((sum, service) => sum + renderWeight(service), 0);
  return Math.max(0.42, services.reduce((sum, service) => sum + renderWeight(service), 0) / Math.max(siblingCount, 1));
}

function insetAngles(node: MonitorNode, start: number, end: number) {
  const inset = Math.min(angularInset(node), Math.max(0, (end - start) * 0.22));
  return { startAngle: start + inset, endAngle: end - inset };
}

function computeSegments(sortBy: SortBy, showNetwork: boolean): SegmentDef[] {
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

function seedFromHash(hash: string): number {
  return hash.split('').reduce((seed, char) => ((seed * 33) ^ char.charCodeAt(0)) >>> 0, 2166136261);
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clampTimeStep(stepMs: number): number {
  return THREE.MathUtils.clamp(stepMs, MIN_TIME_STEP_MS, MAX_TIME_STEP_MS);
}

function nearestResolutionStep(stepMs: number): number {
  const clamped = clampTimeStep(stepMs);
  return RESOLUTION_STEPS_MS.reduce((nearest, candidate) =>
    Math.abs(Math.log(candidate / clamped)) < Math.abs(Math.log(nearest / clamped)) ? candidate : nearest,
  RESOLUTION_STEPS_MS[0]);
}

function sampleHistoryAtResolution(history: HistoryEntry[], stepMs: number, limit: number): HistoryEntry[] {
  if (history.length === 0) return [];
  const resolution = nearestResolutionStep(stepMs);
  const buckets = new Map<number, HistoryEntry>();
  for (const entry of history) {
    buckets.set(Math.floor(entry.timestamp / resolution), entry);
  }
  const sampled = [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
  return sampled.slice(-Math.max(limit, 1));
}

function historyLayerZ(index: number, total: number, spacing = HISTORY_LAYER_GAP): number {
  return HISTORY_Z_PRESENT - Math.max(total - 1 - index, 0) * spacing;
}

function nearestHistoryEntry(history: HistoryEntry[], timestamp: number): HistoryEntry | undefined {
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

function applyGeometryColor(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function timeStepToLayerDistance(stepMs: number): number {
  const normalized = Math.log(clampTimeStep(stepMs) / MIN_TIME_STEP_MS) / Math.log(MAX_TIME_STEP_MS / MIN_TIME_STEP_MS);
  return THREE.MathUtils.lerp(2.85, 0.42, THREE.MathUtils.clamp(normalized, 0, 1));
}

function rulerSpacingPercent(stepMs: number): number {
  const normalized = Math.log(clampTimeStep(stepMs) / MIN_TIME_STEP_MS) / Math.log(MAX_TIME_STEP_MS / MIN_TIME_STEP_MS);
  return THREE.MathUtils.lerp(30, 9, THREE.MathUtils.clamp(normalized, 0, 1));
}

function formatRulerTime(timestamp: number | undefined, stepMs: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (stepMs < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const base = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const year = date.getFullYear();
  return year === new Date().getFullYear() ? base : `${base} ${year}`;
}

function disposeRenderable(object: THREE.Object3D) {
  const renderable = object as THREE.Object3D & {
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  };
  renderable.geometry?.dispose();
  if (Array.isArray(renderable.material)) renderable.material.forEach((material) => material.dispose());
  else renderable.material?.dispose();
}

function makeStarfield(hash: string): THREE.Points {
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

export function UptimeRadar3D({
  dataVersion,
  sortBy,
  showNetwork,
  selectedNodeId,
  timeRange,
  onSelectNode,
  onTooltip,
  onTimeRange,
  onInspectingTime,
  onTimeCursor,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const historyGroupRef = useRef<THREE.Group | null>(null);
  const centerRef = useRef<THREE.Mesh | null>(null);
  const meshRef = useRef<THREE.Mesh[]>([]);
  const historyMeshesRef = useRef<THREE.Object3D[]>([]);
  const dragRef = useRef({
    active: false,
    resetting: false,
    mode: 'rotate' as 'rotate' | 'time',
    x: 0,
    y: 0,
    spin: 0.0018,
    rangeIndex: 1,
    layerDistance: 1,
    targetLayerDistance: 1,
    historySpan: 0,
    timeStepMs: DEFAULT_TIME_STEP_MS,
    targetTimeStepMs: DEFAULT_TIME_STEP_MS,
    historyOffset: 0,
    targetHistoryOffset: 0,
  });
  const gestureRef = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    moved: false,
    twoFinger: false,
  });
  const [historyResolutionMs, setHistoryResolutionMs] = useState(DEFAULT_TIME_STEP_MS);
  const [historyWindowIndex, setHistoryWindowIndex] = useState(-1);
  const historyResolutionRef = useRef(DEFAULT_TIME_STEP_MS);
  const selectedRef = useRef(selectedNodeId);
  const timeRangeRef = useRef(timeRange);
  const cursorRef = useRef('');

  const { showDiskOutline, maxTimeoutMs } = getRuntimeSettings();
  const segments = useMemo(
    () => computeSegments(sortBy, showNetwork),
    [dataVersion, showNetwork, sortBy],
  );
  const radarDiameter = useMemo(() => {
    const defaultSegments = computeSegments(sortBy, showNetwork);
    return Math.max(1, ...defaultSegments.map((segment) => segment.outerRadius * 2));
  }, [dataVersion, showNetwork, sortBy]);

  useEffect(() => {
    selectedRef.current = selectedNodeId;
    setHistoryWindowIndex(-1);
    onInspectingTime(Boolean(selectedNodeId));
  }, [onInspectingTime, selectedNodeId]);

  useEffect(() => {
    timeRangeRef.current = timeRange;
    dragRef.current.rangeIndex = TIME_RANGES.indexOf(timeRange);
  }, [timeRange]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x05070d, 1);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05070d, 7, 18);
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    camera.position.set(0, 0, DEFAULT_CAMERA_Z);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const group = new THREE.Group();
    group.rotation.x = DEFAULT_ROTATION_X;
    const initialQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(DEFAULT_ROTATION_X, 0, 0),
    );
    group.add(makeStarfield(getConfigHash()));
    scene.add(group);
    groupRef.current = group;

    const historyGroup = new THREE.Group();
    historyGroup.visible = false;
    group.add(historyGroup);
    historyGroupRef.current = historyGroup;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0x9db7ff, 1.25);
    key.position.set(-4, -2, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.38);
    rim.position.set(4, 5, -2);
    scene.add(rim);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 96, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: true }),
    );
    core.renderOrder = 5;
    core.userData.center = true;
    centerRef.current = core;
    group.add(core);

    if (showDiskOutline) {
      const ringGroup = new THREE.Group();
      for (let r = 0.72; r <= 2.62; r += 0.38) {
        const curve = new THREE.EllipseCurve(0, 0, r, r, 0, Math.PI * 2, false, 0);
        const points = curve.getPoints(160);
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y, -0.018)));
        ringGroup.add(new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: 0x526071, transparent: true, opacity: 0.14 })));
      }
      group.add(ringGroup);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function resize() {
      if (!mount || !rendererRef.current || !cameraRef.current) return;
      const rect = mount.getBoundingClientRect();
      rendererRef.current.setSize(rect.width, rect.height, false);
      cameraRef.current.aspect = rect.width / Math.max(rect.height, 1);
      cameraRef.current.position.z = DEFAULT_CAMERA_Z;
      cameraRef.current.fov = Math.min(78, 42 * Math.max(1, 1.1 / cameraRef.current.aspect));
      cameraRef.current.updateProjectionMatrix();
    }

    function updatePointer(event: PointerEvent | MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      return rect;
    }

    function pick(event: PointerEvent | MouseEvent) {
      const rect = updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const objects = centerRef.current ? [centerRef.current, ...meshRef.current] : meshRef.current;
      const hits = raycaster.intersectObjects(objects, false);
      const first = hits[0]?.object as THREE.Mesh | undefined;
      if (first?.userData.center) {
        onTooltip(null);
        return { center: true as const };
      }
      const node = first?.userData.node as MonitorNode | undefined;
      if (node) onTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node });
      else onTooltip(null);
      return node ? { node } : null;
    }

    function setHistoryMode(active: boolean) {
      onInspectingTime(active);
    }

    function applyLiveMaterials(selectedId: string | null) {
      for (const mesh of meshRef.current) {
        const node = mesh.userData.node as MonitorNode | undefined;
        const hue = Number(mesh.userData.hue ?? 0);
        const isSelected = Boolean(selectedId && node?.id === selectedId);
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.renderOrder = selectedId ? (isSelected ? 34 : 24) : 28;
        mesh.userData.targetPlanarScale = isSelected ? FOCUSED_PLANAR_SCALE : 1;
        mesh.userData.targetDepthScale = isSelected ? FOCUSED_DEPTH_SCALE : 1;
        mesh.userData.targetOpacity = selectedId ? (isSelected ? 1 : 0.88) : 0.9;
        for (const material of materials) {
          if (node && material instanceof THREE.MeshBasicMaterial) {
            material.color.copy(colorFor(node, hue, maxTimeoutMs));
            material.depthTest = true;
            material.depthWrite = true;
            material.needsUpdate = true;
          }
        }
      }
    }

    function resetView() {
      selectedRef.current = null;
      onSelectNode(null);
      dragRef.current.active = false;
      dragRef.current.resetting = true;
      dragRef.current.spin = 0;
      dragRef.current.targetHistoryOffset = 0;
      dragRef.current.targetTimeStepMs = DEFAULT_TIME_STEP_MS;
      historyResolutionRef.current = DEFAULT_TIME_STEP_MS;
      setHistoryResolutionMs(DEFAULT_TIME_STEP_MS);
      dragRef.current.targetLayerDistance = timeStepToLayerDistance(DEFAULT_TIME_STEP_MS);
      if (centerRef.current) centerRef.current.position.set(0, 0, 0);
      applyLiveMaterials(null);
      setHistoryMode(false);
    }
    function stepTimeRange(direction: number) {
      const next = THREE.MathUtils.clamp(dragRef.current.rangeIndex + direction, 0, TIME_RANGES.length - 1);
      if (next !== dragRef.current.rangeIndex) {
        dragRef.current.rangeIndex = next;
        onTimeRange(TIME_RANGES[next]);
      }
    }

    function rulerHistory() {
      const selected = selectedRef.current ? getNode(selectedRef.current) : null;
      const fallback = getInfrastructures()[0] ?? null;
      const source = selected?.history ?? fallback?.history ?? [];
      return sampleHistoryAtResolution(
        source,
        historyResolutionRef.current,
        selected ? SELECTED_HISTORY_SAMPLES : TOTAL_HISTORY_SAMPLES,
      );
    }

    function visibleHistoryTotal() {
      return Math.max(1, rulerHistory().length);
    }

    function visibleLayerSpacing(total: number) {
      const requested = HISTORY_LAYER_GAP
        * dragRef.current.historySpan
        * dragRef.current.layerDistance
        * (1.72 + (selectedRef.current ? 0.18 : 0));
      const visibleGaps = Math.max(Math.min(total, HISTORY_WINDOW_RADIUS * 2 + 1) - 1, 1);
      return Math.min(requested, (radarDiameter * 0.92) / visibleGaps);
    }

    function currentHistoryPosition(total: number, spacing: number, offsetZ: number) {
      if (spacing < 0.0005) return Math.max(total - 1, 0);
      const localPlaneZ = -offsetZ;
      const oldestZ = historyLayerZ(0, total, spacing);
      return THREE.MathUtils.clamp(
        (localPlaneZ - oldestZ) / spacing,
        0,
        Math.max(total - 1, 0),
      );
    }

    function historyOffsetForPosition(position: number, total: number, spacing: number) {
      return -historyLayerZ(position, total, spacing);
    }

    function clampHistoryOffset(offset: number, total: number, spacing: number) {
      const minOffset = historyOffsetForPosition(Math.max(total - 1, 0), total, spacing);
      const maxOffset = historyOffsetForPosition(0, total, spacing);
      return THREE.MathUtils.clamp(offset, Math.min(minOffset, maxOffset), Math.max(minOffset, maxOffset));
    }

    function snapTargetToNearestHistorySlot(strength: number) {
      const total = visibleHistoryTotal();
      const spacing = visibleLayerSpacing(total);
      dragRef.current.targetHistoryOffset = clampHistoryOffset(dragRef.current.targetHistoryOffset, total, spacing);
      const position = currentHistoryPosition(total, spacing, dragRef.current.targetHistoryOffset);
      const index = Math.round(position);
      const snappedOffset = historyOffsetForPosition(index, total, spacing);
      dragRef.current.targetHistoryOffset = THREE.MathUtils.lerp(
        dragRef.current.targetHistoryOffset,
        snappedOffset,
        THREE.MathUtils.clamp(strength, 0, 1),
      );
      return { position, index, total };
    }

    function publishTimeCursor(position: number, total: number) {
      const history = rulerHistory();
      const safeTotal = Math.max(history.length || total, 1);
      const safePosition = THREE.MathUtils.clamp(position, 0, Math.max(safeTotal - 1, 0));
      const safeIndex = THREE.MathUtils.clamp(Math.round(safePosition), 0, Math.max(history.length - 1, 0));
      const phase = THREE.MathUtils.clamp(safePosition - safeIndex, -0.5, 0.5);
      const current = history[safeIndex];
      const stepMs = historyResolutionRef.current;
      const spacing = rulerSpacingPercent(dragRef.current.timeStepMs);
      const label = formatRulerTime(current?.timestamp, stepMs) || String(safeIndex + 1) + '/' + String(safeTotal);
      const ticks = current
        ? [-1, 1]
            .map((offset) => ({ offset, index: safeIndex + offset }))
            .filter((tick) => tick.index >= 0 && tick.index < history.length)
            .map((tick) => ({
              key: 'relative:' + String(tick.offset),
              label: formatRulerTime(history[tick.index]?.timestamp, stepMs),
              offset: tick.offset,
            }))
            .filter((tick) => tick.label)
        : [];
      const phaseKey = Math.round(phase * 50) / 50;
      const spacingKey = Math.round(spacing * 10) / 10;
      const key = [safeIndex, safeTotal, stepMs, phaseKey, spacingKey, label, ticks.map((tick) => tick.label).join('|')].join(':');
      setHistoryWindowIndex(safeIndex);
      if (cursorRef.current !== key) {
        cursorRef.current = key;
        onTimeCursor({ index: safeIndex, total: safeTotal, label, timestamp: current?.timestamp, phase, spacing, ticks });
      }
    }
    function pointerCentroid() {
      const points = [...gestureRef.current.pointers.values()];
      const total = Math.max(points.length, 1);
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / total,
        y: points.reduce((sum, point) => sum + point.y, 0) / total,
      };
    }

    function scrubHistory(dx: number, dy: number) {
      const total = visibleHistoryTotal();
      const spacing = visibleLayerSpacing(total);
      dragRef.current.targetHistoryOffset = clampHistoryOffset(
        dragRef.current.targetHistoryOffset - dy * 0.018 + dx * 0.006,
        total,
        spacing,
      );
      const snapped = snapTargetToNearestHistorySlot(0.2);
      publishTimeCursor(snapped.position, snapped.total);
    }

    function onPointerDown(event: PointerEvent) {
      if (gestureRef.current.pointers.size === 0) {
        gestureRef.current.moved = false;
        gestureRef.current.twoFinger = false;
      }
      gestureRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const isTwoFinger = event.pointerType === 'touch' && gestureRef.current.pointers.size >= 2;
      const origin = isTwoFinger ? pointerCentroid() : { x: event.clientX, y: event.clientY };
      dragRef.current.active = true;
      dragRef.current.resetting = false;
      dragRef.current.mode = event.button === 2 || isTwoFinger ? 'time' : 'rotate';
      dragRef.current.x = origin.x;
      dragRef.current.y = origin.y;
      dragRef.current.spin = 0;
      if (isTwoFinger) {
        gestureRef.current.twoFinger = true;
        gestureRef.current.moved = true;
      }
      renderer.domElement.setPointerCapture(event.pointerId);
      setHistoryMode(true);
    }

    function onPointerMove(event: PointerEvent) {
      if (gestureRef.current.pointers.has(event.pointerId)) {
        gestureRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (dragRef.current.active && groupRef.current) {
        const isTwoFinger = event.pointerType === 'touch' && gestureRef.current.pointers.size >= 2;
        const point = isTwoFinger ? pointerCentroid() : { x: event.clientX, y: event.clientY };
        if (isTwoFinger && dragRef.current.mode !== 'time') {
          dragRef.current.mode = 'time';
          dragRef.current.x = point.x;
          dragRef.current.y = point.y;
          gestureRef.current.twoFinger = true;
          return;
        }
        const dx = point.x - dragRef.current.x;
        const dy = point.y - dragRef.current.y;
        dragRef.current.x = point.x;
        dragRef.current.y = point.y;
        if (Math.abs(dx) + Math.abs(dy) > 1.5) gestureRef.current.moved = true;
        if (dragRef.current.mode === 'time') {
          scrubHistory(dx, dy);
        } else {
          groupRef.current.rotation.y = THREE.MathUtils.clamp(groupRef.current.rotation.y + dx * 0.0045, -1.18, 1.18);
          groupRef.current.rotation.x = THREE.MathUtils.clamp(groupRef.current.rotation.x + dy * 0.0045, -1.18, 1.18);
          if (event.clientX < 130 && Math.abs(dy) > 7) stepTimeRange(Math.sign(dy));
        }
      }
      pick(event);
    }

    function onPointerUp(event: PointerEvent) {
      gestureRef.current.pointers.delete(event.pointerId);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      if (gestureRef.current.pointers.size > 0) {
        const remaining = [...gestureRef.current.pointers.values()][0];
        dragRef.current.active = true;
        dragRef.current.mode = 'rotate';
        dragRef.current.x = remaining.x;
        dragRef.current.y = remaining.y;
        return;
      }
      dragRef.current.active = false;
      const snapped = snapTargetToNearestHistorySlot(1);
      publishTimeCursor(snapped.position, snapped.total);
      dragRef.current.spin = 0.0014;
    }

    function onPointerCancel(event: PointerEvent) {
      gestureRef.current.pointers.delete(event.pointerId);
      if (gestureRef.current.pointers.size === 0) dragRef.current.active = false;
    }
    function onClick(event: MouseEvent) {
      if (gestureRef.current.moved || gestureRef.current.twoFinger) {
        gestureRef.current.moved = false;
        gestureRef.current.twoFinger = false;
        return;
      }
      const target = pick(event);
      if (target?.center) {
        resetView();
        return;
      }
      if (target?.node) {
        dragRef.current.resetting = false;
        const nextSelected = target.node.id === selectedRef.current ? null : target.node.id;
        selectedRef.current = nextSelected;
        onSelectNode(nextSelected);
        applyLiveMaterials(nextSelected);
        setHistoryMode(Boolean(nextSelected));
      } else {
        dragRef.current.resetting = false;
        selectedRef.current = null;
        onSelectNode(null);
        applyLiveMaterials(null);
        setHistoryMode(false);
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      dragRef.current.resetting = false;
      const wheelUnits = event.deltaY === 0 ? 0 : event.deltaY / 120;
      dragRef.current.targetTimeStepMs = clampTimeStep(
        dragRef.current.targetTimeStepMs * Math.pow(SCROLL_ZOOM_BASE, wheelUnits),
      );
      const nextResolution = nearestResolutionStep(dragRef.current.targetTimeStepMs);
      if (nextResolution !== historyResolutionRef.current) {
        historyResolutionRef.current = nextResolution;
        setHistoryResolutionMs(nextResolution);
      }
      dragRef.current.targetLayerDistance = timeStepToLayerDistance(nextResolution);
      const snapped = snapTargetToNearestHistorySlot(0.46);
      publishTimeCursor(snapped.position, snapped.total);
      setHistoryMode(true);
    }
    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('resize', resize);
    resize();

    let frame = 0;
    function animate() {
      frame = requestAnimationFrame(animate);
      if (groupRef.current) {
        if (dragRef.current.resetting) {
          groupRef.current.quaternion.slerp(initialQuaternion, 0.085);
          if (groupRef.current.quaternion.angleTo(initialQuaternion) < 0.0015) {
            groupRef.current.quaternion.copy(initialQuaternion);
            dragRef.current.resetting = false;
            dragRef.current.spin = 0.0018;
          }
        } else {
          groupRef.current.rotation.z += dragRef.current.spin;
        }
        const sideAmount = THREE.MathUtils.clamp(
          (Math.abs(groupRef.current.rotation.x) + Math.abs(groupRef.current.rotation.y)) / 1.7,
          0,
          1,
        );
        dragRef.current.timeStepMs = THREE.MathUtils.lerp(
          dragRef.current.timeStepMs,
          dragRef.current.targetTimeStepMs,
          0.16,
        );
        dragRef.current.targetLayerDistance = timeStepToLayerDistance(dragRef.current.targetTimeStepMs);
        dragRef.current.layerDistance = THREE.MathUtils.lerp(
          dragRef.current.layerDistance,
          dragRef.current.targetLayerDistance,
          0.1,
        );
        const targetHistorySpan = dragRef.current.resetting ? 0 : sideAmount;
        dragRef.current.historySpan = THREE.MathUtils.lerp(
          dragRef.current.historySpan,
          targetHistorySpan,
          0.08,
        );
        if (targetHistorySpan === 0 && dragRef.current.historySpan < 0.002) {
          dragRef.current.historySpan = 0;
        }
        if (historyGroupRef.current) {
          historyGroupRef.current.visible = dragRef.current.historySpan >= 0.002;
          const total = visibleHistoryTotal();
          const spacing = visibleLayerSpacing(total);
          if (dragRef.current.resetting) {
            dragRef.current.targetHistoryOffset = 0;
          } else {
            dragRef.current.targetHistoryOffset = clampHistoryOffset(
              dragRef.current.targetHistoryOffset,
              total,
              spacing,
            );
            if (!dragRef.current.active || dragRef.current.mode !== 'time') snapTargetToNearestHistorySlot(0.34);
          }
          dragRef.current.historyOffset = THREE.MathUtils.lerp(dragRef.current.historyOffset, dragRef.current.targetHistoryOffset, 0.12);
          historyGroupRef.current.position.z = dragRef.current.historyOffset;
          for (const historyMesh of historyMeshesRef.current) {
            const timelineIndex = Number(historyMesh.userData.timelineIndex ?? total - 1);
            const timelineTotal = Number(historyMesh.userData.timelineTotal ?? total);
            historyMesh.position.z = historyLayerZ(timelineIndex, timelineTotal, spacing);
          }
          publishTimeCursor(currentHistoryPosition(total, spacing, dragRef.current.historyOffset), total);
        }
        if (centerRef.current) centerRef.current.position.set(0, 0, 0);
      }
      for (const mesh of meshRef.current) {
        const targetPlanarScale = Number(mesh.userData.targetPlanarScale ?? 1);
        const targetDepthScale = Number(mesh.userData.targetDepthScale ?? 1);
        mesh.scale.x = THREE.MathUtils.lerp(mesh.scale.x, targetPlanarScale, FOCUS_EASING);
        mesh.scale.y = THREE.MathUtils.lerp(mesh.scale.y, targetPlanarScale, FOCUS_EASING);
        mesh.scale.z = THREE.MathUtils.lerp(mesh.scale.z, targetDepthScale, FOCUS_EASING);
        if (
          Math.abs(mesh.scale.x - targetPlanarScale) < 0.0005
          && Math.abs(mesh.scale.z - targetDepthScale) < 0.0005
        ) {
          mesh.scale.set(targetPlanarScale, targetPlanarScale, targetDepthScale);
        }
        const targetOpacity = Number(mesh.userData.targetOpacity ?? 0.9);
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshBasicMaterial) {
            material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, FOCUS_EASING);
          }
        }
      }
      if (centerRef.current) {
        centerRef.current.rotation.x += 0.0018;
        centerRef.current.rotation.y += 0.0012;
      }
      if (cameraRef.current) cameraRef.current.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [maxTimeoutMs, onInspectingTime, onSelectNode, onTimeCursor, onTimeRange, onTooltip, radarDiameter, showDiskOutline]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    for (const mesh of meshRef.current) {
      group.remove(mesh);
      mesh.traverse((child) => {
        if (child !== mesh) disposeRenderable(child);
      });
      disposeRenderable(mesh);
    }
    meshRef.current = [];

    for (const segment of segments) {
      const shape = annularShape(segment.innerRadius, segment.outerRadius, segment.startAngle, segment.endAngle);
      const layerDepth = segment.ring === 'service' ? 0.08 : 0.05;
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: layerDepth, bevelEnabled: false });
      geometry.translate(0, 0, segment.ring === 'network' ? 0.05 : 0);
      const material = new THREE.MeshBasicMaterial({
        color: colorFor(segment.node, segment.hue, maxTimeoutMs),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const isSelected = selectedRef.current === segment.node.id;
      mesh.renderOrder = selectedRef.current ? (isSelected ? 34 : 24) : 28;
      mesh.userData.node = segment.node;
      mesh.userData.ring = segment.ring;
      mesh.userData.hue = segment.hue;
      mesh.userData.targetPlanarScale = isSelected ? FOCUSED_PLANAR_SCALE : 1;
      mesh.userData.targetDepthScale = isSelected ? FOCUSED_DEPTH_SCALE : 1;
      mesh.userData.targetOpacity = selectedRef.current ? (isSelected ? 1 : 0.88) : 0.9;
      meshRef.current.push(mesh);
      group.add(mesh);

      if (showDiskOutline) {
        const edges = new THREE.EdgesGeometry(geometry, 20);
        mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
          color: 0xd7dde8,
          transparent: true,
          opacity: 0.09,
        })));
      }
    }
  }, [maxTimeoutMs, segments, showDiskOutline]);

  useEffect(() => {
    const historyGroup = historyGroupRef.current;
    if (!historyGroup) return;

    for (const mesh of historyMeshesRef.current) {
      historyGroup.remove(mesh);
      disposeRenderable(mesh);
    }
    historyMeshesRef.current = [];

    const selected = selectedNodeId ? getNode(selectedNodeId) : null;
    const fallback = getInfrastructures()[0] ?? null;
    const timelineSource = selected?.history ?? fallback?.history ?? [];
    const sampleLimit = selected ? SELECTED_HISTORY_SAMPLES : TOTAL_HISTORY_SAMPLES;
    const timeline = sampleHistoryAtResolution(timelineSource, historyResolutionMs, sampleLimit);
    if (timeline.length === 0) return;

    const centerIndex = THREE.MathUtils.clamp(
      historyWindowIndex < 0 ? timeline.length - 1 : historyWindowIndex,
      0,
      timeline.length - 1,
    );
    const firstIndex = Math.max(0, centerIndex - HISTORY_WINDOW_RADIUS);
    const lastIndex = Math.min(timeline.length - 1, centerIndex + HISTORY_WINDOW_RADIUS);
    const historySegments = segments
      .filter((segment) => !selectedNodeId || segment.node.id === selectedNodeId)
      .map((segment) => {
        const shape = annularShape(segment.innerRadius, segment.outerRadius, segment.startAngle, segment.endAngle);
        const layerDepth = segment.ring === 'service' ? 0.08 : 0.05;
        const template = new THREE.ExtrudeGeometry(shape, { depth: layerDepth, bevelEnabled: false });
        const geometry = template.index ? template.toNonIndexed() : template;
        if (geometry !== template) template.dispose();
        geometry.deleteAttribute('normal');
        geometry.deleteAttribute('uv');
        return {
          segment,
          layerDepth,
          template: geometry,
          history: sampleHistoryAtResolution(segment.node.history, historyResolutionMs, sampleLimit),
        };
      });

    for (let timelineIndex = firstIndex; timelineIndex <= lastIndex; timelineIndex += 1) {
      const distance = Math.abs(timelineIndex - centerIndex);
      const alpha = Math.max(0, 1 - distance / HISTORY_WINDOW_RADIUS);
      if (alpha <= 0.01) continue;

      const timestamp = timeline[timelineIndex].timestamp;
      const layerGeometries: THREE.BufferGeometry[] = [];
      for (const item of historySegments) {
        const entry = nearestHistoryEntry(item.history, timestamp);
        if (!entry) continue;
        const geometry = item.template.clone();
        geometry.translate(0, 0, -item.layerDepth);
        applyGeometryColor(geometry, historyColor(entry, item.segment.hue, maxTimeoutMs));
        layerGeometries.push(geometry);
      }
      if (layerGeometries.length === 0) continue;

      const merged = mergeGeometries(layerGeometries, false);
      layerGeometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;

      const historyMesh = new THREE.Mesh(
        merged,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: alpha * (selectedNodeId ? 0.76 : 0.24),
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
        }),
      );
      historyMesh.renderOrder = selectedNodeId ? 42 : 12;
      historyMesh.userData.timelineIndex = timelineIndex;
      historyMesh.userData.timelineTotal = timeline.length;
      historyGroup.add(historyMesh);
      historyMeshesRef.current.push(historyMesh);
    }

    historySegments.forEach((item) => item.template.dispose());
  }, [historyResolutionMs, historyWindowIndex, maxTimeoutMs, segments, selectedNodeId]);
  return <div ref={mountRef} className="radar-3d" />;
}
