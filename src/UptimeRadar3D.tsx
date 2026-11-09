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

import { EMBED_MARGIN, TIME_RANGES, SELECTED_HISTORY_SAMPLES, TOTAL_HISTORY_SAMPLES, HISTORY_WINDOW_RADIUS, MIN_TIME_STEP_MS, MAX_TIME_STEP_MS, DEFAULT_TIME_STEP_MS, SCROLL_ZOOM_BASE, DEFAULT_CAMERA_Z, DEFAULT_ROTATION_X, HISTORY_LAYER_GAP, HISTORY_Z_PRESENT, LIGHTNESS_MIN, LIGHTNESS_MAX, INNER_RING_START, RING_GAP, RING_RADIAL_TRAVEL, INFRASTRUCTURE_THICKNESS_BASE, SERVICE_THICKNESS_BASE, NETWORK_THICKNESS_BASE, MAX_RADIAL_SCALE, INFRASTRUCTURE_BAND_WIDTH, SERVICE_BAND_START, SERVICE_BAND_WIDTH, NETWORK_BAND_START, NETWORK_BAND_WIDTH, FOCUSED_PLANAR_SCALE, FOCUSED_DEPTH_SCALE, FOCUS_EASING, RESOLUTION_STEPS_MS, latencyLightness, colorFor, historyColor, annularShape, clampRenderPadding, stableRenderPadding, renderWeight, stableUnit, angularInset, radialThickness, aggregateServiceSize, derivedRadialThickness, radialBounds, networkRenderWeight, insetAngles, computeSegments, seedFromHash, seededRandom, clampTimeStep, nearestResolutionStep, sampleHistoryAtResolution, historyLayerZ, nearestHistoryEntry, applyGeometryColor, timeStepToLayerDistance, rulerSpacingPercent, formatRulerTime, disposeRenderable, makeStarfield } from './radarGeometry';
import type { Props, SegmentDef } from './radarGeometry';

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
  embed = false,
  theme = 'dark',
  fit = 'contain',
  monochrome = false,
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

    const light = theme === 'light';
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: embed,
      powerPreference: embed ? 'low-power' : 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x05070d, embed ? 0 : 1);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = embed ? null : new THREE.Fog(0x05070d, 7, 18);
    scene.background = embed ? new THREE.Color(theme === 'dark' ? '#000000' : '#ffffff') : null;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    camera.position.set(0, 0, DEFAULT_CAMERA_Z);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const group = new THREE.Group();
    group.rotation.x = DEFAULT_ROTATION_X;
    const initialQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(DEFAULT_ROTATION_X, 0, 0),
    );
    if (!embed) group.add(makeStarfield(getConfigHash()));
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
      new THREE.MeshBasicMaterial({ color: light ? 0x2a3140 : 0xffffff, depthTest: true, depthWrite: true }),
    );
    core.renderOrder = 5;
    core.userData.center = true;
    centerRef.current = core;
    group.add(core);

    if (showDiskOutline) {
      const ringGroup = new THREE.Group();
      // In embed mode, keep the guides inside the radar so the fitted disc fills the viewport.
      const maxGuideRadius = embed ? radarDiameter / 2 + 0.05 : 2.62;
      for (let r = 0.72; r <= maxGuideRadius; r += 0.38) {
        const curve = new THREE.EllipseCurve(0, 0, r, r, 0, Math.PI * 2, false, 0);
        const points = curve.getPoints(160);
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y, -0.018)));
        ringGroup.add(new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: light ? 0x3a4352 : 0x526071, transparent: true, opacity: light ? 0.22 : 0.14 })));
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
      if (embed) {
        // Fit the radar disc to the viewport: "contain" keeps it whole, "cover" fills the longer side.
        const aspect = cameraRef.current.aspect;
        const halfFov = THREE.MathUtils.degToRad(42 / 2);
        const span = fit === 'cover' ? Math.max(1, aspect) : Math.min(1, aspect);
        cameraRef.current.fov = 42;
        cameraRef.current.position.z = ((radarDiameter / 2) * EMBED_MARGIN) / (Math.tan(halfFov) * span);
      } else {
        cameraRef.current.position.z = DEFAULT_CAMERA_Z;
        cameraRef.current.fov = Math.min(78, 42 * Math.max(1, 1.1 / cameraRef.current.aspect));
      }
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
            material.color.copy(colorFor(node, hue, maxTimeoutMs, monochrome));
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

    if (!embed) {
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
      renderer.domElement.addEventListener('pointercancel', onPointerCancel);
      renderer.domElement.addEventListener('click', onClick);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
      renderer.domElement.addEventListener('contextmenu', onContextMenu);
    }
    window.addEventListener('resize', resize);
    // The canvas is sized by CSS; re-measure whenever the container changes
    // size, not only on window resize (e.g. iframe or layout changes).
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => resize());
    resizeObserver?.observe(mount);
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
      resizeObserver?.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
    };
  }, [embed, fit, monochrome, maxTimeoutMs, onInspectingTime, onSelectNode, onTimeCursor, onTimeRange, onTooltip, radarDiameter, showDiskOutline, theme]);

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
        color: colorFor(segment.node, segment.hue, maxTimeoutMs, monochrome),
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
          color: theme === 'light' ? 0x2a3140 : 0xd7dde8,
          transparent: true,
          opacity: theme === 'light' ? 0.14 : 0.09,
        })));
      }
    }
  }, [maxTimeoutMs, segments, showDiskOutline, theme, monochrome]);

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
