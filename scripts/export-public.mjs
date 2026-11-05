// Writes sanitized public JSON next to a built dashboard and verifies it.
//
//   node scripts/export-public.mjs [outDir]
//
// Reads config.yml (or CONFIG) plus public/uptime-history.json and
// public/uptime-latest.json, writes public-safe circtime-config.json,
// uptime-history.json and uptime-latest.json into outDir (default: dist),
// removes any admin bundle there, and fails if a leak is detected.
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from './config-utils.mjs';
import {
  configNodeIds,
  findLeaks,
  privateLiterals,
  sanitizeConfig,
  sanitizeHistory,
  sanitizeLatest,
  stringifyPublic,
  writeFileAtomic,
} from './public-safe.mjs';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, process.argv[2] ?? 'dist');
const publicDir = path.join(rootDir, 'public');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

const config = readConfig(rootDir);
const adminToken = process.env.CIRCTIME_ADMIN_TOKEN || config.settings.admin_token || '';
const publicConfig = sanitizeConfig(config);
const ids = configNodeIds(publicConfig);
const files = {
  'circtime-config.json': publicConfig,
  'uptime-history.json': sanitizeHistory(readJson(path.join(publicDir, 'uptime-history.json'), {}), ids),
  'uptime-latest.json': sanitizeLatest(readJson(path.join(publicDir, 'uptime-latest.json'), {}), ids),
};

const secrets = privateLiterals(config, adminToken);
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(path.join(outDir, 'circtime-admin.json'), { force: true });

let failed = false;
for (const [name, value] of Object.entries(files)) {
  const text = `${stringifyPublic(value)}\n`;
  const leaks = findLeaks(text, secrets);
  if (leaks.length > 0) {
    failed = true;
    fs.rmSync(path.join(outDir, name), { force: true });
    console.error(`Refusing to publish ${name}: ${leaks.join(', ')}`);
    continue;
  }
  writeFileAtomic(path.join(outDir, name), text);
}

if (failed) process.exit(1);
console.log(`Wrote public-safe JSON to ${path.relative(rootDir, outDir) || '.'}`);
