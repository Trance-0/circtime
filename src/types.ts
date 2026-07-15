/**
 * circtime data model
 *
 * Three-layer architecture:
 *   1. Infrastructure — providers or machines (inner ring)
 *   2. Service — deployed services (middle ring)
 *   3. Network — routing/proxy layer (outer ring, optional)
 *
 * Each node has a status, uptime history, and belongs to an infrastructure.
 * Node identity determines hue, uptime controls saturation, and latency
 * controls brightness.
 */

// ── Status ──────────────────────────────────────────────────────────

export type NodeStatus = 'up' | 'degraded' | 'down' | 'unknown';

// ── History ─────────────────────────────────────────────────────────

export interface HistoryEntry {
  timestamp: number;         // Unix ms
  status: NodeStatus;
  latencyMs: number;
  statusCode: number;
  message: string;
}

// ── Node types ──────────────────────────────────────────────────────

export type NodeType = 'infrastructure' | 'service' | 'network';

export interface BaseNode {
  id: string;
  name: string;
  type: NodeType;
  status: NodeStatus;
  hue?: number;
  /** Visual size hint: 1 = largest padding/smallest section, 5 = smallest padding/largest section. */
  renderPadding?: number;
  url: string;                // Monitoring URL (empty for now)
  uptimePercent: number;      // 0–100
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastCheckTime: number;      // Unix ms
  history: HistoryEntry[];
  /** Parent infrastructure id (services & network nodes) */
  infrastructureId?: string;
  /** Direct dependency ids */
  dependsOn: string[];
}

export interface InfrastructureNode extends BaseNode {
  type: 'infrastructure';
  /** Stable hue in [0, 360) assigned to this infrastructure */
  hue: number;
  services: string[];         // child service ids
  networkNodes: string[];     // child network ids
}

export interface ServiceNode extends BaseNode {
  type: 'service';
  infrastructureId: string;
}

export interface NetworkNode extends BaseNode {
  type: 'network';
  infrastructureId: string;
}

export type MonitorNode = InfrastructureNode | ServiceNode | NetworkNode;

// ── Dashboard state ─────────────────────────────────────────────────

export type TimeRange = '1h' | '24h' | '7d' | '30d';

export type SortBy = 'name' | 'uptime' | 'status';

export interface DashboardState {
  selectedNodeId: string | null;
  timeRange: TimeRange;
  showNetwork: boolean;
  sortBy: SortBy;
}

// ── Tooltip ─────────────────────────────────────────────────────────

export interface TooltipData {
  x: number;
  y: number;
  node: MonitorNode;
}

// ── Layout geometry ─────────────────────────────────────────────────

/**
 * Describes a single arc segment in the radial layout.
 * Angles in radians, measured clockwise from 12-o'clock (top).
 */
export interface ArcSegment {
  nodeId: string;
  ring: 'infrastructure' | 'service' | 'network';
  innerRadius: number;
  outerRadius: number;
  startAngle: number;   // radians
  endAngle: number;     // radians
  hue: number;
  saturation: number;   // 0–100
  lightness: number;    // 0–100
}
