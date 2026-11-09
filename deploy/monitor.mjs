// Continuous circtime monitor for a self-hosted, public-safe deployment.
//
// Runs inside the container defined in deploy/compose.yml:
//   /app      read-only checkout of this repository
//   /config   read-only directory holding config.yml
//   /state    private, persistent work dir (history, node_modules, staging)
//   /out      served directory: built app + sanitized JSON only
//
// Each cycle runs `check:sites` and republishes the sanitized JSON. The static
// app is rebuilt only when the source or config.yml fingerprint changes.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.env.CIRCTIME_SRC ?? '/app';
const CONFIG = process.env.CIRCTIME_CONFIG ?? '/config/config.yml';
const STATE = process.env.CIRCTIME_STATE ?? '/state';
const OUT = process.env.CIRCTIME_OUT ?? '/out';
const WORK = path.join(STATE, 'work');
const BUILD_STAMP = path.join(STATE, 'build.sha256');
const DEPS_STAMP = path.join(STATE, 'deps.sha256');
const HEARTBEAT = path.join(STATE, 'heartbeat');

// Only these repository paths are copied into the build workspace.
const SOURCE_PATHS = [
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'public',
  'scripts',
  'src',
];
const PUBLIC_JSON = new Set(['circtime-config.json', 'uptime-history.json', 'uptime-latest.json']);

const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

function walk(root, rel = '') {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(abs).sort().flatMap((name) => walk(root, path.join(rel, name)));
}

function sourceFiles() {
  return SOURCE_PATHS.flatMap((entry) => walk(SRC, entry))
    // Never take generated monitor data from the checkout.
    .filter((file) => !(file.startsWith('public/') && file.endsWith('.json')));
}

function fingerprint(files, extra = []) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file).update('\0').update(fs.readFileSync(path.join(SRC, file))).update('\0');
  }
  for (const item of extra) hash.update(item).update('\0');
  return hash.digest('hex');
}

function readStamp(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function run(command, args, env = {}) {
  execFileSync(command, args, { cwd: WORK, stdio: 'inherit', env: { ...process.env, ...env } });
}

function syncSource(files) {
  for (const entry of ['src', 'scripts']) fs.rmSync(path.join(WORK, entry), { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(WORK, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(SRC, file), target);
  }
  const configLink = path.join(WORK, 'config.yml');
  fs.rmSync(configLink, { force: true });
  fs.symlinkSync(CONFIG, configLink);
}

function setModes(root) {
  for (const rel of walk(root)) fs.chmodSync(path.join(root, rel), 0o644);
  const dirs = [root];
  while (dirs.length) {
    const dir = dirs.pop();
    fs.chmodSync(dir, 0o755);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(dir, entry.name));
    }
  }
}

// Copies the built app into OUT without ever copying JSON from the build
// (raw history/admin bundle); sanitized JSON is written separately.
function publishStatic() {
  const dist = path.join(WORK, 'dist');
  const files = walk(dist).filter((file) => !file.endsWith('.json') && !path.basename(file).startsWith('.'));
  const keep = new Set(files);
  // Assets first, index.html last, so a reader never sees an index that
  // points at missing hashed assets.
  files.sort((a, b) => (a === 'index.html') - (b === 'index.html'));
  for (const file of files) {
    const target = path.join(OUT, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp`);
    fs.copyFileSync(path.join(dist, file), tmp);
    fs.chmodSync(tmp, 0o644);
    fs.renameSync(tmp, target);
  }
  for (const file of walk(OUT)) {
    if (!keep.has(file) && !PUBLIC_JSON.has(file)) fs.rmSync(path.join(OUT, file), { force: true });
  }
  setModes(OUT);
}

function buildIfNeeded() {
  const files = sourceFiles();
  const configText = fs.readFileSync(CONFIG, 'utf8');
  const buildHash = fingerprint(files, [configText]);
  if (buildHash === readStamp(BUILD_STAMP) && fs.existsSync(path.join(OUT, 'index.html'))) return;

  log('source or config changed; rebuilding static app');
  fs.mkdirSync(WORK, { recursive: true });
  syncSource(files);

  const depsHash = fingerprint(files.filter((file) => file === 'package-lock.json' || file === 'package.json'));
  if (depsHash !== readStamp(DEPS_STAMP) || !fs.existsSync(path.join(WORK, 'node_modules'))) {
    run('npm', ['ci', '--no-audit', '--no-fund']);
    fs.writeFileSync(DEPS_STAMP, depsHash);
  }

  fs.rmSync(path.join(WORK, 'dist'), { recursive: true, force: true });
  run('npm', ['run', 'build'], { CIRCTIME_PUBLIC_SAFE: '1' });
  publishStatic();
  fs.writeFileSync(BUILD_STAMP, buildHash);
  log('static app published');
}

function checkAndPublish() {
  run('node', ['scripts/check-sites.mjs']);
  run('node', ['scripts/export-public.mjs', OUT]);
  setModes(OUT);
  fs.writeFileSync(HEARTBEAT, String(Date.now()));
}

function intervalMs() {
  const match = /check_interval_minutes:\s*([0-9.]+)/.exec(fs.readFileSync(CONFIG, 'utf8'));
  const minutes = match ? Number(match[1]) : 1;
  return Math.max(0.5, Number.isFinite(minutes) ? minutes : 1) * 60 * 1000;
}

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    process.exit(0);
  });
}

fs.mkdirSync(OUT, { recursive: true });
while (!stopping) {
  const started = Date.now();
  try {
    buildIfNeeded();
    checkAndPublish();
  } catch (error) {
    log(`cycle failed: ${error.message}`);
  }
  const wait = Math.max(5000, intervalMs() - (Date.now() - started));
  await new Promise((resolve) => setTimeout(resolve, wait));
}
