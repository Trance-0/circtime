import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from './yaml-lite.mjs';

const DEFAULT_REQUEST = {
  method: 'GET',
  timeout_ms: 10000,
  degraded_after_ms: 1500,
  expected_status: [200, 204, 301, 302],
  degraded_status: [429, 500, 502, 503, 504],
  headers: {},
};

const DEFAULT_SETTINGS = {
  page_title: 'circtime',
  admin_token: '',
  check_interval_minutes: 15,
  history_retention_days: 365,
  history_limit: 35040,
  concurrency: 4,
  request: DEFAULT_REQUEST,
};

const INFRA_HUES = [210, 35, 280, 150, 0, 195, 315, 90, 250, 20];

function slugify(value, fallback) {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function asNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeRenderPadding(raw = {}) {
  const value = raw.render_padding ?? raw.renderPadding ?? raw.padding;
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Math.round(asNumber(value, Number.NaN));
  return Number.isFinite(numeric) ? Math.min(5, Math.max(1, numeric)) : undefined;
}

function asString(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function normalizeRequest(raw = {}) {
  return {
    ...DEFAULT_REQUEST,
    ...raw,
    expected_status: asArray(raw.expected_status).length > 0
      ? asArray(raw.expected_status).map(Number)
      : DEFAULT_REQUEST.expected_status,
    degraded_status: asArray(raw.degraded_status).length > 0
      ? asArray(raw.degraded_status).map(Number)
      : DEFAULT_REQUEST.degraded_status,
    headers: raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
      ? raw.headers
      : {},
    timeout_ms: asNumber(raw.timeout_ms, DEFAULT_REQUEST.timeout_ms),
    degraded_after_ms: asNumber(raw.degraded_after_ms, DEFAULT_REQUEST.degraded_after_ms),
    method: asString(raw.method, DEFAULT_REQUEST.method).toUpperCase(),
  };
}

function normalizePorts(raw) {
  return asArray(raw.server_ports ?? raw.server_port ?? raw.port)
    .map((port) => Number(port))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
}

function normalizeNode(raw = {}, fallbackId, inherited = {}) {
  const id = slugify(raw.id ?? raw.name ?? raw.server_name, fallbackId);
  const hue = raw.hue === undefined ? undefined : ((asNumber(raw.hue, 0) % 360) + 360) % 360;
  const ui = asString(raw.UI ?? raw.ui);
  const url = asString(raw.url ?? raw.public_url);
  const checkUrl = asString(raw.check_url ?? raw.health_url ?? raw.url ?? ui);

  return {
    id,
    name: asString(raw.name ?? raw.server_name, id),
    hue,
    render_padding: normalizeRenderPadding(raw),
    url,
    check_url: checkUrl,
    check_host: asString(raw.check_host ?? raw.host ?? raw.ip_address ?? inherited.ip_address),
    server_ports: normalizePorts(raw),
    domains: asArray(raw.domains ?? raw.domain).map(String),
    depends_on: asArray(raw.depends_on ?? raw.dependsOn).map(String),
    request: raw.request && typeof raw.request === 'object' ? normalizeRequest(raw.request) : undefined,
    admin: {
      server_name: asString(raw.server_name ?? inherited.server_name),
      infrastructure_id: asString(inherited.infrastructure_id),
      type: asString(raw.type ?? inherited.type),
      computing_power: asString(raw.computing_power ?? inherited.computing_power),
      ip_address: asString(raw.ip_address ?? inherited.ip_address),
      operating_system: asString(raw.operating_system ?? inherited.operating_system),
      web_server: asString(raw.web_server ?? inherited.web_server),
      ui,
      server_ports: normalizePorts(raw),
      domains: asArray(raw.domains ?? raw.domain).map(String),
      stack: asString(raw.stack),
      image: asString(raw.image),
      state: asString(raw.state),
      local_port: raw.local_port ?? raw.localPort ?? '',
      remote_port: raw.remote_port ?? raw.remotePort ?? '',
      protocol: asString(raw.protocol ?? raw.proxy_type ?? raw.type),
      notes: asString(raw.notes ?? raw.note),
    },
  };
}

export function normalizeConfig(raw) {
  const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    page_title: asString(rawSettings.page_title, DEFAULT_SETTINGS.page_title),
    admin_token: asString(rawSettings.admin_token, DEFAULT_SETTINGS.admin_token),
    check_interval_minutes: asNumber(rawSettings.check_interval_minutes, DEFAULT_SETTINGS.check_interval_minutes),
    history_retention_days: Math.max(1, asNumber(rawSettings.history_retention_days, DEFAULT_SETTINGS.history_retention_days)),
    history_limit: asNumber(rawSettings.history_limit, DEFAULT_SETTINGS.history_limit),
    concurrency: Math.max(1, asNumber(rawSettings.concurrency, DEFAULT_SETTINGS.concurrency)),
    request: normalizeRequest(rawSettings.request ?? {}),
  };

  const infrastructure = asArray(raw.infrastructure).map((infraRaw, infraIndex) => {
    const infra = normalizeNode(infraRaw, `infrastructure-${infraIndex + 1}`);
    const inherited = {
      infrastructure_id: infra.id,
      server_name: infra.name,
      type: infraRaw.type,
      computing_power: infraRaw.computing_power,
      ip_address: infraRaw.ip_address,
      operating_system: infraRaw.operating_system,
      web_server: infraRaw.web_server,
    };

    return {
      ...infra,
      hue: ((asNumber(infraRaw.hue, INFRA_HUES[infraIndex % INFRA_HUES.length]) % 360) + 360) % 360,
      services: asArray(infraRaw.services).map((serviceRaw, serviceIndex, services) => {
        const service = normalizeNode(serviceRaw, `${infra.id}-service-${serviceIndex + 1}`, inherited);
        return {
          ...service,
          hue: service.hue ?? Math.round((serviceIndex / Math.max(services.length, 1)) * 360),
        };
      }),
      network: asArray(infraRaw.network).map((networkRaw, networkIndex) =>
        normalizeNode(networkRaw, `${infra.id}-network-${networkIndex + 1}`, inherited),
      ),
    };
  });

  return {
    version: 2,
    settings,
    infrastructure,
  };
}

export function readConfig(rootDir = process.cwd()) {
  const configPath = path.join(rootDir, 'config.yml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config.yml at ${configPath}`);
  }

  const raw = parseYamlLite(fs.readFileSync(configPath, 'utf8'));
  return normalizeConfig(raw);
}

function publicNode(node) {
  return {
    id: node.id,
    name: node.name,
    hue: node.hue,
    render_padding: node.render_padding,
    url: '',
    depends_on: node.depends_on,
    domains: node.domains,
  };
}

export function toPublicConfig(config, adminEnabled = false) {
  return {
    version: config.version,
    settings: {
      page_title: config.settings.page_title,
      check_interval_minutes: config.settings.check_interval_minutes,
      history_retention_days: config.settings.history_retention_days,
      history_limit: config.settings.history_limit,
    },
    admin: {
      encrypted: adminEnabled,
      bundle: adminEnabled ? 'circtime-admin.json' : null,
    },
    infrastructure: config.infrastructure.map((infra) => ({
      ...publicNode(infra),
      hue: infra.hue,
      services: infra.services.map(publicNode),
      network: infra.network.map(publicNode),
    })),
  };
}

export function toAdminPayload(config) {
  return {
    version: config.version,
    generatedAt: new Date().toISOString(),
    infrastructure: config.infrastructure.map((infra) => ({
      id: infra.id,
      name: infra.name,
      hue: infra.hue,
      render_padding: infra.render_padding,
      depends_on: infra.depends_on,
      admin: infra.admin,
      services: infra.services.map((service) => ({
        id: service.id,
        name: service.name,
        hue: service.hue,
        render_padding: service.render_padding,
        depends_on: service.depends_on,
        check_url: service.check_url,
        check_host: service.check_host,
        server_ports: service.server_ports,
        domains: service.domains,
        admin: service.admin,
      })),
      network: infra.network.map((network) => ({
        id: network.id,
        name: network.name,
        hue: network.hue,
        render_padding: network.render_padding,
        depends_on: network.depends_on,
        check_url: network.check_url,
        check_host: network.check_host,
        server_ports: network.server_ports,
        domains: network.domains,
        admin: network.admin,
      })),
    })),
  };
}

export function flattenConfigNodes(config) {
  return config.infrastructure.flatMap((infra) => [
    { ...infra, type: 'infrastructure', infrastructureId: undefined, check_host: infra.check_host || infra.admin.ip_address },
    ...infra.services.map((service) => ({
      ...service,
      type: 'service',
      infrastructureId: infra.id,
      hue: service.hue ?? infra.hue,
      check_host: service.check_host || infra.admin.ip_address,
    })),
    ...infra.network.map((network) => ({
      ...network,
      type: 'network',
      infrastructureId: infra.id,
      hue: network.hue ?? infra.hue,
      check_host: network.check_host || infra.admin.ip_address,
    })),
  ]);
}