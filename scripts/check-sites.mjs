import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { flattenConfigNodes, readConfig } from './config-utils.mjs';

const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const historyPath = path.join(publicDir, 'uptime-history.json');
const latestPath = path.join(publicDir, 'uptime-latest.json');

function emptyHistoryFile() {
  return {
    version: 1,
    generatedAt: null,
    checks: {},
  };
}

function readHistory() {
  if (!fs.existsSync(historyPath)) return emptyHistoryFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    return {
      ...emptyHistoryFile(),
      ...parsed,
      checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {},
    };
  } catch (error) {
    console.warn(`Could not read existing history: ${error.message}`);
    return emptyHistoryFile();
  }
}

function mergeRequest(defaultRequest, nodeRequest) {
  return {
    ...defaultRequest,
    ...(nodeRequest ?? {}),
    headers: {
      ...(defaultRequest.headers ?? {}),
      ...(nodeRequest?.headers ?? {}),
    },
  };
}

function tcpConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, latencyMs: Date.now() - started, message: `TCP ${host}:${port} timed out` });
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve({ ok: true, latencyMs: Date.now() - started, message: `TCP ${host}:${port} open` });
    });

    socket.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, latencyMs: Date.now() - started, message: `TCP ${host}:${port} ${error.code ?? error.message}` });
    });
  });
}

async function checkTcpNode(node, defaultRequest) {
  const host = node.check_host;
  const ports = node.server_ports ?? [];
  if (!host || ports.length === 0) return null;

  const timeoutMs = mergeRequest(defaultRequest, node.request).timeout_ms;
  const results = await Promise.all(ports.map((port) => tcpConnect(host, port, timeoutMs)));
  const ok = results.every((result) => result.ok);
  const latencyMs = Math.max(...results.map((result) => result.latencyMs), 0);

  return {
    timestamp: Date.now(),
    status: ok ? 'up' : 'down',
    latencyMs,
    statusCode: 0,
    message: results.map((result) => result.message).join('; '),
  };
}

async function checkHttpNode(node, defaultRequest) {
  const targetUrl = node.check_url || node.url;
  if (!targetUrl) return null;

  const request = mergeRequest(defaultRequest, node.request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
  const started = Date.now();

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    const latencyMs = Date.now() - started;
    const expected = new Set(request.expected_status.map(Number));
    const degraded = new Set(request.degraded_status.map(Number));

    let status = 'down';
    let message = `HTTP ${response.status}`;
    if (expected.has(response.status)) {
      status = latencyMs > request.degraded_after_ms ? 'degraded' : 'up';
      message = status === 'degraded'
        ? `HTTP ${response.status}, slow response`
        : `HTTP ${response.status}`;
    } else if (degraded.has(response.status)) {
      status = 'degraded';
      message = `HTTP ${response.status}, degraded status`;
    }

    return {
      timestamp: started,
      status,
      latencyMs,
      statusCode: response.status,
      message,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    return {
      timestamp: started,
      status: 'down',
      latencyMs,
      statusCode: 0,
      message: error.name === 'AbortError'
        ? `Timed out after ${request.timeout_ms}ms`
        : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkNode(node, defaultRequest) {
  const httpResult = await checkHttpNode(node, defaultRequest);
  if (httpResult) return httpResult;

  const tcpResult = await checkTcpNode(node, defaultRequest);
  if (tcpResult) return tcpResult;

  return {
    timestamp: Date.now(),
    status: 'unknown',
    latencyMs: 0,
    statusCode: 0,
    message: 'No check_url, url, or TCP server_port configured in config.yml',
  };
}

async function runPool(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

fs.mkdirSync(publicDir, { recursive: true });
const config = readConfig(rootDir);
const nodes = flattenConfigNodes(config);
const historyFile = readHistory();
const checkedAt = new Date().toISOString();

const entries = await runPool(nodes, config.settings.concurrency, async (node) => {
  const entry = await checkNode(node, config.settings.request);
  console.log(`${node.id}: ${entry.status} (${entry.message})`);
  return [node.id, entry];
});

const retentionCutoff = Date.now() - config.settings.history_retention_days * 24 * 60 * 60 * 1000;
const isWithinRetention = (check) => {
  const timestamp = typeof check?.timestamp === 'number' ? check.timestamp : Date.parse(check?.timestamp);
  return Number.isFinite(timestamp) && timestamp >= retentionCutoff;
};

for (const [nodeId, checks] of Object.entries(historyFile.checks)) {
  const recent = Array.isArray(checks)
    ? checks.filter(isWithinRetention).slice(-config.settings.history_limit)
    : [];
  if (recent.length > 0) historyFile.checks[nodeId] = recent;
  else delete historyFile.checks[nodeId];
}

for (const [nodeId, entry] of entries) {
  const existing = Array.isArray(historyFile.checks[nodeId]) ? historyFile.checks[nodeId] : [];
  historyFile.checks[nodeId] = [...existing, entry].slice(-config.settings.history_limit);
}

historyFile.generatedAt = checkedAt;
historyFile.configVersion = config.version;
historyFile.historyRetentionDays = config.settings.history_retention_days;
historyFile.historyLimit = config.settings.history_limit;

const latest = Object.fromEntries(entries.map(([nodeId, entry]) => [nodeId, entry]));
fs.writeFileSync(historyPath, `${JSON.stringify(historyFile)}\n`);
fs.writeFileSync(latestPath, `${JSON.stringify({ generatedAt: checkedAt, checks: latest }, null, 2)}\n`);

console.log(`Wrote ${path.relative(rootDir, historyPath)}`);