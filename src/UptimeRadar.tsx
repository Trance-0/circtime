/**
 * UptimeRadar.tsx
 *
 * Main concentric-ring SVG visualization.
 */

import { useMemo, useState, useCallback } from 'react';
import type { TooltipData, SortBy, ArcSegment } from './types';
import {
  getInfrastructures,
  getServicesFor,
  getNetworkFor,
  getNode,
} from './dataStore';
import { nodeColor, nodeColorHover, nodeStroke } from './statusColor';

const SVG_SIZE = 600;
const CENTER = SVG_SIZE / 2;

const INFRA_INNER = 90;
const INFRA_OUTER = 140;
const SVC_INNER = 150;
const SVC_OUTER = 220;
const NET_INNER = 230;
const NET_OUTER = 270;

const GAP_ANGLE = 0.02;
const TWO_PI = Math.PI * 2;

/**
 * Build an SVG arc path for a ring segment.
 * Angles are radians, with 0 at 12 o'clock and clockwise positive.
 */
function arcPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const toSvg = (a: number) => a - Math.PI / 2;

  const a1 = toSvg(startAngle);
  const a2 = toSvg(endAngle);

  const outerX1 = cx + outerR * Math.cos(a1);
  const outerY1 = cy + outerR * Math.sin(a1);
  const outerX2 = cx + outerR * Math.cos(a2);
  const outerY2 = cy + outerR * Math.sin(a2);

  const innerX1 = cx + innerR * Math.cos(a1);
  const innerY1 = cy + innerR * Math.sin(a1);
  const innerX2 = cx + innerR * Math.cos(a2);
  const innerY2 = cy + innerR * Math.sin(a2);

  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;

  return [
    `M ${outerX1} ${outerY1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerX2} ${outerY2}`,
    `L ${innerX2} ${innerY2}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerX1} ${innerY1}`,
    'Z',
  ].join(' ');
}

function labelPosition(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): { x: number; y: number; rotation: number } {
  const midAngle = (startAngle + endAngle) / 2;
  const svgAngle = midAngle - Math.PI / 2;
  return {
    x: cx + radius * Math.cos(svgAngle),
    y: cy + radius * Math.sin(svgAngle),
    rotation: (midAngle * 180) / Math.PI,
  };
}

function statusLightness(status: string): number {
  if (status === 'up') return 55;
  if (status === 'degraded') return 38;
  if (status === 'down') return 18;
  return 30;
}

function computeSegments(sortBy: SortBy, showNetwork: boolean): ArcSegment[] {
  const infras = [...getInfrastructures()];

  if (sortBy === 'name') {
    infras.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === 'uptime') {
    infras.sort((a, b) => a.uptimePercent - b.uptimePercent);
  } else if (sortBy === 'status') {
    const order: Record<string, number> = { down: 0, degraded: 1, unknown: 2, up: 3 };
    infras.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
  }

  const weights = infras.map((inf) => {
    const svcCount = getServicesFor(inf.id).length;
    const netCount = showNetwork ? getNetworkFor(inf.id).length : 0;
    return Math.max(svcCount + netCount, 1);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const segments: ArcSegment[] = [];
  let angle = 0;

  for (let i = 0; i < infras.length; i += 1) {
    const inf = infras[i];
    const infraAngle = (weights[i] / totalWeight) * (TWO_PI - infras.length * GAP_ANGLE);
    const infraStart = angle;
    const infraEnd = angle + infraAngle;

    segments.push({
      nodeId: inf.id,
      ring: 'infrastructure',
      innerRadius: INFRA_INNER,
      outerRadius: INFRA_OUTER,
      startAngle: infraStart,
      endAngle: infraEnd,
      hue: inf.hue,
      saturation: 10 + (inf.uptimePercent / 100) * 75,
      lightness: statusLightness(inf.status),
    });

    const services = getServicesFor(inf.id);
    const networkNodes = showNetwork ? getNetworkFor(inf.id) : [];

    if (services.length > 0) {
      const svcArc = infraAngle / services.length;
      for (let j = 0; j < services.length; j += 1) {
        const svc = services[j];
        segments.push({
          nodeId: svc.id,
          ring: 'service',
          innerRadius: SVC_INNER,
          outerRadius: SVC_OUTER,
          startAngle: infraStart + j * svcArc,
          endAngle: infraStart + (j + 1) * svcArc,
          hue: inf.hue,
          saturation: 10 + (svc.uptimePercent / 100) * 75,
          lightness: statusLightness(svc.status),
        });
      }
    }

    if (networkNodes.length > 0) {
      const netArc = infraAngle / networkNodes.length;
      for (let j = 0; j < networkNodes.length; j += 1) {
        const net = networkNodes[j];
        segments.push({
          nodeId: net.id,
          ring: 'network',
          innerRadius: NET_INNER,
          outerRadius: NET_OUTER,
          startAngle: infraStart + j * netArc,
          endAngle: infraStart + (j + 1) * netArc,
          hue: inf.hue,
          saturation: 10 + (net.uptimePercent / 100) * 75,
          lightness: statusLightness(net.status),
        });
      }
    }

    angle = infraEnd + GAP_ANGLE;
  }

  return segments;
}

function segmentCenter(seg: ArcSegment): { x: number; y: number } {
  const midAngle = (seg.startAngle + seg.endAngle) / 2 - Math.PI / 2;
  const midR = (seg.innerRadius + seg.outerRadius) / 2;
  return {
    x: CENTER + midR * Math.cos(midAngle),
    y: CENTER + midR * Math.sin(midAngle),
  };
}

interface Props {
  sortBy: SortBy;
  showNetwork: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onTooltip: (data: TooltipData | null) => void;
}

export function UptimeRadar({
  sortBy,
  showNetwork,
  selectedNodeId,
  onSelectNode,
  onTooltip,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const segments = useMemo(
    () => computeSegments(sortBy, showNetwork),
    [sortBy, showNetwork],
  );

  const segmentMap = useMemo(() => {
    const map = new Map<string, ArcSegment>();
    for (const segment of segments) map.set(segment.nodeId, segment);
    return map;
  }, [segments]);

  const depLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; hue: number }[] = [];
    for (const seg of segments) {
      const node = getNode(seg.nodeId);
      if (!node || node.dependsOn.length === 0) continue;
      const from = segmentCenter(seg);
      for (const depId of node.dependsOn) {
        const depSeg = segmentMap.get(depId);
        if (!depSeg) continue;
        const to = segmentCenter(depSeg);
        lines.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, hue: seg.hue });
      }
    }
    return lines;
  }, [segments, segmentMap]);

  const handleMouseEnter = useCallback(
    (nodeId: string, e: React.MouseEvent<SVGPathElement>) => {
      setHoveredId(nodeId);
      const node = getNode(nodeId);
      if (node) {
        const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
        onTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          node,
        });
      }
    },
    [onTooltip],
  );

  const handleMouseMove = useCallback(
    (nodeId: string, e: React.MouseEvent<SVGPathElement>) => {
      const node = getNode(nodeId);
      if (node) {
        const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
        onTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          node,
        });
      }
    },
    [onTooltip],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
    onTooltip(null);
  }, [onTooltip]);

  return (
    <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="uptime-radar-svg">
      <text x={CENTER} y={CENTER - INFRA_INNER + 18} textAnchor="middle" className="ring-label">
        Infrastructure
      </text>
      <text x={CENTER} y={CENTER - SVC_INNER + 18} textAnchor="middle" className="ring-label">
        Services
      </text>
      {showNetwork && (
        <text x={CENTER} y={CENTER - NET_INNER + 16} textAnchor="middle" className="ring-label ring-label-small">
          Network
        </text>
      )}

      <circle cx={CENTER} cy={CENTER} r={INFRA_INNER - 10} fill="#111827" stroke="#1f2937" strokeWidth={1} />
      <text x={CENTER} y={CENTER - 8} textAnchor="middle" className="center-title">
        circtime
      </text>
      <text x={CENTER} y={CENTER + 12} textAnchor="middle" className="center-subtitle">
        uptime radar
      </text>

      {depLines.map((line, i) => (
        <line
          key={`dep-${i}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={`hsla(${line.hue}, 40%, 50%, 0.15)`}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}

      {segments.map((seg) => {
        const node = getNode(seg.nodeId);
        if (!node) return null;
        const isHovered = hoveredId === seg.nodeId;
        const isSelected = selectedNodeId === seg.nodeId;

        const fill = isHovered || isSelected
          ? nodeColorHover(seg.hue, node.uptimePercent, node.status)
          : nodeColor(seg.hue, node.uptimePercent, node.status);
        const stroke = isSelected ? '#ffffff' : nodeStroke(seg.hue, node.status);

        return (
          <path
            key={seg.nodeId}
            d={arcPath(CENTER, CENTER, seg.innerRadius, seg.outerRadius, seg.startAngle, seg.endAngle)}
            fill={fill}
            stroke={stroke}
            strokeWidth={isSelected ? 2 : 0.5}
            className="arc-segment"
            onClick={() => onSelectNode(seg.nodeId === selectedNodeId ? null : seg.nodeId)}
            onMouseEnter={(e) => handleMouseEnter(seg.nodeId, e)}
            onMouseMove={(e) => handleMouseMove(seg.nodeId, e)}
            onMouseLeave={handleMouseLeave}
          />
        );
      })}

      {segments.map((seg) => {
        const angularSpan = seg.endAngle - seg.startAngle;
        if (angularSpan < 0.15) return null;

        const node = getNode(seg.nodeId);
        if (!node) return null;

        const midR = (seg.innerRadius + seg.outerRadius) / 2;
        const pos = labelPosition(CENTER, CENTER, midR, seg.startAngle, seg.endAngle);

        let rot = pos.rotation;
        if (rot > 90 && rot < 270) rot += 180;

        return (
          <text
            key={`label-${seg.nodeId}`}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(${rot}, ${pos.x}, ${pos.y})`}
            className={`segment-label ${seg.ring === 'network' ? 'segment-label-small' : ''}`}
            pointerEvents="none"
          >
            {node.name.length > 18 ? `${node.name.slice(0, 16)}...` : node.name}
          </text>
        );
      })}

      {segments
        .filter((seg) => {
          const node = getNode(seg.nodeId);
          return node?.status === 'down';
        })
        .map((seg) => {
          const midAngle = (seg.startAngle + seg.endAngle) / 2 - Math.PI / 2;
          const r = seg.outerRadius + 8;
          const x = CENTER + r * Math.cos(midAngle);
          const y = CENTER + r * Math.sin(midAngle);
          return (
            <g key={`warn-${seg.nodeId}`}>
              <circle cx={x} cy={y} r={6} fill="#ef4444" opacity={0.9} />
              <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={9} fontWeight={700}>
                !
              </text>
            </g>
          );
        })}
    </svg>
  );
}