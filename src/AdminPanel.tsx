import { useMemo, useState } from 'react';
import { getAllNodes } from './dataStore';
import { statusBadgeColor } from './statusColor';
import type { MonitorNode, NodeStatus } from './types';

interface AdminBundle {
  version: number;
  kdf: string;
  iterations: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface AdminNodeMeta {
  server_name?: string;
  infrastructure_id?: string;
  type?: string;
  computing_power?: string;
  ip_address?: string;
  operating_system?: string;
  web_server?: string;
  ui?: string;
  server_ports?: number[];
  domains?: string[];
  stack?: string;
  image?: string;
  state?: string;
  notes?: string;
}

interface AdminChild {
  id: string;
  name: string;
  depends_on?: string[];
  check_url?: string;
  check_host?: string;
  server_ports?: number[];
  domains?: string[];
  admin?: AdminNodeMeta;
}

interface AdminInfrastructure extends AdminChild {
  hue: number;
  services: AdminChild[];
  network: AdminChild[];
}

interface AdminPayload {
  version: number;
  generatedAt: string;
  infrastructure: AdminInfrastructure[];
}

interface FlatAdminNode extends AdminChild {
  kind: 'infrastructure' | 'service' | 'network';
  infrastructureId?: string;
}

interface Props {
  dataVersion: number;
}

function publicUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${fileName}`;
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function decryptBundle(bundle: AdminBundle, token: string): Promise<AdminPayload> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: asArrayBuffer(fromBase64(bundle.salt)),
      iterations: bundle.iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const ciphertext = fromBase64(bundle.ciphertext);
  const tag = fromBase64(bundle.tag);
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(fromBase64(bundle.iv)) },
    key,
    asArrayBuffer(sealed),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as AdminPayload;
}

function flattenAdmin(payload: AdminPayload): FlatAdminNode[] {
  return payload.infrastructure.flatMap((infra) => [
    { ...infra, kind: 'infrastructure' as const },
    ...infra.network.map((node) => ({ ...node, kind: 'network' as const, infrastructureId: infra.id })),
    ...infra.services.map((node) => ({ ...node, kind: 'service' as const, infrastructureId: infra.id })),
  ]);
}

function currentStatus(nodeId: string, publicNodes: MonitorNode[]): NodeStatus {
  return publicNodes.find((node) => node.id === nodeId)?.status ?? 'unknown';
}

function statusWeight(status: NodeStatus): number {
  if (status === 'down') return 50;
  if (status === 'degraded') return 22;
  if (status === 'unknown') return 6;
  return 0;
}

function isNetworkLike(node: FlatAdminNode): boolean {
  const label = `${node.kind} ${node.id} ${node.name}`.toLowerCase();
  return node.kind === 'network' || /frp|dns|proxy|tunnel|nginx|gateway|router/.test(label);
}

function buildDiagnostics(payload: AdminPayload, publicNodes: MonitorNode[]) {
  const flat = flattenAdmin(payload);
  const dependents = new Map<string, FlatAdminNode[]>();
  for (const node of flat) {
    for (const depId of node.depends_on ?? []) {
      const list = dependents.get(depId) ?? [];
      list.push(node);
      dependents.set(depId, list);
    }
  }

  return flat
    .map((node) => {
      const status = currentStatus(node.id, publicNodes);
      const directDependents = dependents.get(node.id) ?? [];
      const unhealthyDependents = directDependents.filter((dep) => {
        const depStatus = currentStatus(dep.id, publicNodes);
        return depStatus === 'down' || depStatus === 'degraded' || depStatus === 'unknown';
      });
      const score = statusWeight(status)
        + unhealthyDependents.length * 18
        + directDependents.length * 3
        + (isNetworkLike(node) ? 20 : 0)
        + (node.kind === 'infrastructure' ? 10 : 0);

      return {
        node,
        status,
        score,
        impacted: unhealthyDependents,
        reason: unhealthyDependents.length > 1
          ? `${unhealthyDependents.length} dependent services are also unhealthy`
          : status === 'down'
            ? 'Node is currently down'
            : status === 'degraded'
              ? 'Node is degraded'
              : 'No strong root-cause signal yet',
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function formatPorts(ports?: number[]): string {
  return ports && ports.length > 0 ? ports.join(', ') : 'none';
}

export function AdminPanel({ dataVersion }: Props) {
  const [token, setToken] = useState('');
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const publicNodes = useMemo(() => getAllNodes(), [dataVersion, payload]);
  const diagnostics = useMemo(
    () => (payload ? buildDiagnostics(payload, publicNodes) : []),
    [payload, publicNodes],
  );

  async function unlock() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(publicUrl('circtime-admin.json'), { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('No encrypted admin bundle was published for this deployment.');
      }
      const bundle = await response.json() as AdminBundle;
      setPayload(await decryptBundle(bundle, token));
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : 'Could not unlock admin bundle.');
    } finally {
      setLoading(false);
    }
  }

  if (!payload) {
    return (
      <div className="admin-panel">
        <h3 className="admin-title">Admin Debug</h3>
        <input
          className="admin-token-input"
          type="password"
          value={token}
          placeholder="Deploy admin token"
          onChange={(event) => setToken(event.target.value)}
        />
        <button className="admin-unlock" onClick={unlock} disabled={loading || token.length === 0}>
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
        {error && <div className="admin-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="admin-panel admin-panel-unlocked">
      <div className="admin-header-row">
        <h3 className="admin-title">Admin Debug</h3>
        <button className="admin-link-button" onClick={() => setPayload(null)}>Lock</button>
      </div>

      <div className="admin-section">
        <span className="admin-section-label">Fix First</span>
        <div className="admin-fix-list">
          {diagnostics.slice(0, 8).map((item) => (
            <div key={item.node.id} className="admin-fix-row">
              <span className="admin-status-dot" style={{ background: statusBadgeColor(item.status) }} />
              <div>
                <div className="admin-fix-name">{item.node.name}</div>
                <div className="admin-muted">{item.reason}</div>
                {item.impacted.length > 0 && (
                  <div className="admin-muted">Impacts: {item.impacted.slice(0, 4).map((node) => node.name).join(', ')}</div>
                )}
              </div>
              <span className="admin-score">{item.score}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <span className="admin-section-label">Servers</span>
        <div className="admin-server-list">
          {payload.infrastructure.map((server) => {
            const status = currentStatus(server.id, publicNodes);
            return (
              <details key={server.id} className="admin-server">
                <summary>
                  <span className="admin-status-dot" style={{ background: statusBadgeColor(status) }} />
                  {server.name}
                </summary>
                <div className="admin-grid">
                  <span>Type</span><strong>{server.admin?.type || 'unknown'}</strong>
                  <span>IP</span><strong>{server.admin?.ip_address || 'not set'}</strong>
                  <span>OS</span><strong>{server.admin?.operating_system || 'not set'}</strong>
                  <span>Web</span><strong>{server.admin?.web_server || 'not set'}</strong>
                  <span>Power</span><strong>{server.admin?.computing_power || 'not set'}</strong>
                </div>
                <div className="admin-service-list">
                  {[...server.network, ...server.services].map((service) => {
                    const serviceStatus = currentStatus(service.id, publicNodes);
                    return (
                      <div key={service.id} className="admin-service-row">
                        <span className="admin-status-dot" style={{ background: statusBadgeColor(serviceStatus) }} />
                        <div>
                          <strong>{service.name}</strong>
                          <div className="admin-muted">ports: {formatPorts(service.server_ports)}</div>
                          {service.admin?.ui && <div className="admin-muted">ui: {service.admin.ui}</div>}
                          {service.domains && service.domains.length > 0 && <div className="admin-muted">domains: {service.domains.join(', ')}</div>}
                          {service.admin?.notes && <div className="admin-muted">note: {service.admin.notes}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}