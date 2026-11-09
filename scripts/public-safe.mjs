// Public-safe output for anonymous viewers.
//
// The sanitized files keep only display names, ids, groups, status, latency,
// HTTP status codes and timestamps. URLs, hostnames, IPs, ports, domains,
// free-form check messages, admin data and tokens are dropped.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const STATUSES = new Set(['up', 'degraded', 'down', 'unknown']);

function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInt(value, min, max) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(max, Math.max(min, numeric));
}

// Messages are rebuilt from status fields only, never copied from the raw
// check output (which can contain hostnames, IPs, ports or resolver errors).
function safeMessage(status, statusCode) {
  if (status === 'unknown') return 'not checked';
  if (statusCode > 0) {
    if (status === 'up') return `status ${statusCode}`;
    if (status === 'degraded') return `status ${statusCode}, degraded`;
    return `status ${statusCode}, down`;
  }
  if (status === 'up') return 'reachable';
  if (status === 'degraded') return 'degraded';
  return 'unreachable';
}

export function sanitizeEntry(entry) {
  const timestamp = toEpochMs(entry?.timestamp);
  if (timestamp === null) return null;
  const status = STATUSES.has(entry?.status) ? entry.status : 'unknown';
  const statusCode = safeInt(entry?.statusCode, 0, 999);
  return {
    timestamp,
    status,
    latencyMs: safeInt(entry?.latencyMs, 0, 600000),
    statusCode,
    message: safeMessage(status, statusCode),
  };
}

function sanitizeChecks(checks, allowedIds, mapEntry) {
  const result = {};
  if (!checks || typeof checks !== 'object') return result;
  for (const [id, value] of Object.entries(checks)) {
    if (!allowedIds.has(id)) continue;
    const sanitized = mapEntry(value);
    if (sanitized !== null && sanitized !== undefined) result[id] = sanitized;
  }
  return result;
}

export function sanitizeHistory(history, allowedIds) {
  return {
    version: 1,
    generatedAt: toEpochMs(history?.generatedAt),
    historyRetentionDays: safeInt(history?.historyRetentionDays, 0, 100000),
    historyLimit: safeInt(history?.historyLimit, 0, 10000000),
    checks: sanitizeChecks(history?.checks, allowedIds, (entries) =>
      Array.isArray(entries) ? entries.map(sanitizeEntry).filter(Boolean) : null),
  };
}

export function sanitizeLatest(latest, allowedIds) {
  return {
    generatedAt: toEpochMs(latest?.generatedAt),
    checks: sanitizeChecks(latest?.checks, allowedIds, sanitizeEntry),
  };
}

function publicNode(node) {
  return {
    id: String(node.id),
    name: String(node.name ?? node.id),
    hue: Number.isFinite(node.hue) ? node.hue : undefined,
    render_padding: Number.isFinite(node.render_padding) ? node.render_padding : undefined,
    url: '',
    depends_on: Array.isArray(node.depends_on) ? node.depends_on.map(String) : [],
  };
}

// Accepts either the generated public config or a normalized config.
export function sanitizeConfig(config) {
  const settings = config?.settings ?? {};
  const infrastructure = (config?.infrastructure ?? []).map((infra) => ({
    ...publicNode(infra),
    services: (infra.services ?? []).map(publicNode),
    network: (infra.network ?? []).map(publicNode),
  }));
  const sanitized = {
    version: config?.version ?? 2,
    settings: {
      page_title: String(settings.page_title ?? 'circtime'),
      show_disk_outline: settings.show_disk_outline !== false,
      max_timeout_ms: safeInt(settings.max_timeout_ms ?? 5000, 1, 600000),
      check_interval_minutes: Number(settings.check_interval_minutes) || 15,
      history_retention_days: safeInt(settings.history_retention_days ?? 365, 1, 100000),
      history_limit: safeInt(settings.history_limit ?? 35040, 1, 10000000),
    },
    admin: { encrypted: false, bundle: null },
    infrastructure,
  };
  // The layout seed is derived from the sanitized structure, so it reveals
  // nothing about the private config file.
  sanitized.config_hash = crypto.createHash('sha256').update(JSON.stringify(sanitized)).digest('hex');
  return sanitized;
}

export function configNodeIds(config) {
  const ids = new Set();
  for (const infra of config?.infrastructure ?? []) {
    ids.add(String(infra.id));
    for (const node of [...(infra.services ?? []), ...(infra.network ?? [])]) ids.add(String(node.id));
  }
  return ids;
}

// JSON with ": " after keys so that a simple `:[0-9]{2,5}` grep over the
// served directory only matches real host:port leaks, never JSON numbers.
export function stringifyPublic(value) {
  if (Array.isArray(value)) return `[${value.map(stringifyPublic).join(',')}]`;
  if (value && typeof value === 'object') {
    const parts = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}: ${stringifyPublic(item)}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const LEAK_PATTERNS = [
  { name: 'url scheme', pattern: /https?:|wss?:/i },
  { name: 'loopback', pattern: /127\.0\.0\.1|localhost|\[::1\]/i },
  { name: 'ipv4', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { name: 'port', pattern: /:[0-9]{2,5}/ },
  { name: 'admin', pattern: /admin_token|circtime-admin|ciphertext/i },
];

// Returns a list of problems for one public JSON text. `secrets` holds extra
// literal strings (admin token, configured hosts) that must never appear.
export function findLeaks(text, secrets = []) {
  const problems = LEAK_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
  for (const secret of secrets) {
    if (secret && text.includes(secret)) problems.push('configured secret or host');
  }
  return [...new Set(problems)];
}

// Collects private literals from a normalized config: the admin token and
// every hostname, IP and URL that appears in check targets.
export function privateLiterals(config, adminToken = '') {
  const literals = new Set();
  if (adminToken) literals.add(adminToken);
  const addUrl = (value) => {
    if (!value) return;
    literals.add(value);
    try {
      const parsed = new URL(value);
      literals.add(parsed.host);
      literals.add(parsed.hostname);
    } catch {
      // Not a URL; the literal itself is still checked.
    }
  };
  for (const infra of config?.infrastructure ?? []) {
    for (const node of [infra, ...(infra.services ?? []), ...(infra.network ?? [])]) {
      addUrl(node.url);
      addUrl(node.check_url);
      if (node.check_host) literals.add(node.check_host);
      for (const domain of node.domains ?? []) literals.add(domain);
      if (node.admin?.ip_address) literals.add(node.admin.ip_address);
    }
  }
  return [...literals].filter((value) => value.length >= 4);
}

export function writeFileAtomic(filePath, contents, mode = 0o644) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, contents, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
}
