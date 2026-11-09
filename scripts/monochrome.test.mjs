import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const code = ts.transpileModule(readFileSync(new URL('../src/statusColor.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { monochromeColor } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('status colors prioritize current outages and use exactly the last 48 hours', () => {
  const now = Date.now(); const at = hours => now - hours * 3600000;
  assert.equal(monochromeColor({ status: 'down', history: [] }, now), '#ef4444');
  assert.equal(monochromeColor({ status: 'unknown', history: [] }, now), '#ef4444');
  assert.equal(monochromeColor({ status: 'up', history: [{ timestamp: at(47), status: 'down' }, { timestamp: now, status: 'up' }] }, now), '#f59e0b');
  assert.equal(monochromeColor({ status: 'up', history: [{ timestamp: at(49), status: 'down' }, { timestamp: now, status: 'up' }] }, now), '#22c55e');
  assert.equal(monochromeColor({ status: 'up', history: [{ timestamp: at(48), status: 'down' }, { timestamp: now, status: 'up' }] }, now), '#f59e0b');
});
