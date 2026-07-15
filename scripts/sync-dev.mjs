import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_BRANCH = 'main';
const TARGET_BRANCH = 'dev';
const DEV_FIXTURES = [
  'config.yml',
  'public/uptime-history.json',
  'public/uptime-latest.json',
];

function git(args, options = {}) {
  const output = execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  return typeof output === 'string' ? output.trim() : '';
}

let branch = git(['branch', '--show-current']);
if (branch !== SOURCE_BRANCH && branch !== TARGET_BRANCH) {
  throw new Error(`Run npm run sync:dev from ${SOURCE_BRANCH} or ${TARGET_BRANCH} (current: ${branch || 'detached HEAD'}).`);
}

const dirty = git(['status', '--porcelain', '--untracked-files=no']);
if (dirty) {
  throw new Error('Commit or restore tracked changes before syncing dev.');
}

if (branch === SOURCE_BRANCH) {
  if (existsSync(resolve('config.yml'))) {
    throw new Error('Move the ignored production config.yml out of the worktree before switching to dev.');
  }
  git(['switch', TARGET_BRANCH], { inherit: true });
  branch = TARGET_BRANCH;
}

const fixtureHashes = new Map(
  DEV_FIXTURES.map((path) => [path, git(['hash-object', path])]),
);

git(['merge', '--no-edit', SOURCE_BRANCH], { inherit: true });

for (const [path, expectedHash] of fixtureHashes) {
  const actualHash = git(['hash-object', path]);
  if (actualHash !== expectedHash) {
    throw new Error(`Dev fixture changed during merge: ${path}`);
  }
}

const differences = git(['diff', '--name-only', `${SOURCE_BRANCH}..HEAD`])
  .split(/\r?\n/)
  .filter(Boolean);
const unexpected = differences.filter((path) => !DEV_FIXTURES.includes(path));
if (unexpected.length > 0) {
  throw new Error(`Dev contains non-fixture changes after sync:\n${unexpected.join('\n')}`);
}

console.log(`Synced ${SOURCE_BRANCH} into ${TARGET_BRANCH}; preserved ${DEV_FIXTURES.length} dev fixtures.`);
