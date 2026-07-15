import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig, readConfigSource, toAdminPayload, toPublicConfig } from './config-utils.mjs';

const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const publicConfigPath = path.join(publicDir, 'circtime-config.json');
const adminBundlePath = path.join(publicDir, 'circtime-admin.json');


function encryptAdminPayload(payload, token) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(token, salt, 150000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 150000,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

fs.mkdirSync(publicDir, { recursive: true });
const configHash = crypto.createHash('sha256').update(readConfigSource(rootDir)).digest('hex');
const config = readConfig(rootDir);
const adminToken = process.env.CIRCTIME_ADMIN_TOKEN || config.settings.admin_token || '';
const adminEnabled = adminToken.length > 0;
const publicConfig = {
  ...toPublicConfig(config, adminEnabled),
  config_hash: configHash,
};

fs.writeFileSync(publicConfigPath, `${JSON.stringify(publicConfig, null, 2)}\n`);

if (adminEnabled) {
  const adminBundle = encryptAdminPayload(toAdminPayload(config), adminToken);
  fs.writeFileSync(adminBundlePath, `${JSON.stringify(adminBundle, null, 2)}\n`);
  console.log(`Wrote encrypted ${path.relative(rootDir, adminBundlePath)}`);
} else if (fs.existsSync(adminBundlePath)) {
  fs.rmSync(adminBundlePath);
}

console.log(`Wrote ${path.relative(rootDir, publicConfigPath)} from config.yml or CONFIG`);
