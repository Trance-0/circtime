import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConfig } from './config-utils.mjs';
import {
  configNodeIds,
  findLeaks,
  privateLiterals,
  sanitizeConfig,
  sanitizeHistory,
  sanitizeLatest,
  stringifyPublic,
} from './public-safe.mjs';

const raw = {
  settings: { page_title: 'Radar', admin_token: 'super-secret-token-value' },
  infrastructure: [{
    id: 'host',
    name: 'Host',
    ip_address: '10.1.2.3',
    domains: ['internal.example.net'],
    services: [{ id: 'api', name: 'API', url: 'http://127.0.0.1:8080/healthz', depends_on: [] }],
    network: [{ id: 'edge', name: 'Edge', url: 'https://edge.example.com/', depends_on: [] }],
  }],
};

test('sanitized config, history and latest contain no private data', () => {
  const config = normalizeConfig(raw);
  const publicConfig = sanitizeConfig(config);
  const ids = configNodeIds(publicConfig);
  const entry = { timestamp: Date.now(), status: 'down', latencyMs: 12.4, statusCode: 0, message: 'connect ECONNREFUSED 127.0.0.1:8080' };
  const history = sanitizeHistory({ generatedAt: new Date().toISOString(), checks: { api: [entry], gone: [entry] } }, ids);
  const latest = sanitizeLatest({ generatedAt: new Date().toISOString(), checks: { api: entry } }, ids);

  const secrets = privateLiterals(config, raw.settings.admin_token);
  for (const value of [publicConfig, history, latest]) {
    assert.deepEqual(findLeaks(stringifyPublic(value), secrets), []);
  }
  assert.equal(history.checks.gone, undefined);
  assert.equal(history.checks.api[0].message, 'unreachable');
  assert.equal(history.checks.api[0].latencyMs, 12);
  assert.equal(typeof latest.generatedAt, 'number');
  assert.deepEqual(publicConfig.admin, { encrypted: false, bundle: null });
  assert.equal(publicConfig.infrastructure[0].services[0].url, '');
});

test('leak detection flags urls, hosts, ports and secrets', () => {
  assert.ok(findLeaks('"x": "http://a"').includes('url scheme'));
  assert.ok(findLeaks('"x": "127.0.0.1"').includes('loopback'));
  assert.ok(findLeaks('"x": "host:8080"').includes('port'));
  assert.deepEqual(findLeaks('"x": 8080'), []);
  assert.deepEqual(findLeaks('"x": "token-abc"', ['token-abc']), ['configured secret or host']);
});

test('stringifyPublic round-trips through JSON.parse', () => {
  const value = { a: [1, { b: 'c:"d' }], e: null, f: undefined };
  assert.deepEqual(JSON.parse(stringifyPublic(value)), { a: [1, { b: 'c:"d' }], e: null });
});
