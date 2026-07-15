import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const samplePath = path.join(rootDir, 'config.sample.yml');
const configPath = path.join(rootDir, 'config.yml');

if (fs.existsSync(configPath)) {
  console.log('config.yml already exists; leaving it unchanged.');
  process.exit(0);
}

const token = crypto.randomBytes(32).toString('base64url');
const sample = fs.readFileSync(samplePath, 'utf8');
const config = sample.replace('admin_token: ""', `admin_token: "${token}"`);
fs.writeFileSync(configPath, config);
console.log('Created ignored config.yml with a generated admin token.');
