import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import fs from 'node:fs/promises';

const COMMON_PREFIXES = [
  '', 'www', 'api', 'app', 'admin', 'auth', 'blog', 'cdn', 'cloud', 'dashboard',
  'docs', 'git', 'grafana', 'home', 'immich', 'jenkins', 'jellyfin', 'mail',
  'mc', 'minecraft', 'nas', 'nextcloud', 'panel', 'portainer', 'status', 'vpn',
];

function cleanDomain(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '');
}

function validDomain(value) {
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'host';
}

async function dnsQuery(hostname, type) {
  try {
    const response = await fetch(
      'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(hostname) + '&type=' + type,
      {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) return [];
    const payload = await response.json();
    return payload.Status === 0 ? payload.Answer ?? [] : [];
  } catch {
    return [];
  }
}

async function certificateNames(domain) {
  try {
    const response = await fetch(
      'https://crt.sh/?q=' + encodeURIComponent('%.' + domain) + '&output=json',
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return [];
    const rows = await response.json();
    return rows
      .flatMap((row) => String(row.name_value ?? '').split('\n'))
      .map((name) => cleanDomain(name.replace(/^\*\./, '')))
      .filter((name) => name === domain || name.endsWith('.' + domain));
  } catch {
    return [];
  }
}

function providerFor(target) {
  if (/cloudflare|pages\.dev/.test(target)) return 'Cloudflare edge';
  if (/vercel|vercel-dns/.test(target)) return 'Vercel';
  if (/github\.io|github\.com/.test(target)) return 'GitHub Pages';
  if (/netlify/.test(target)) return 'Netlify';
  if (/amazonaws|cloudfront/.test(target)) return 'AWS';
  return 'Public host';
}

async function probeHost(hostname) {
  const cnameAnswers = await dnsQuery(hostname, 'CNAME');
  const cname = cnameAnswers.find((answer) => answer.type === 5)?.data?.replace(/\.$/, '').toLowerCase();
  const target = cname || hostname;
  const [aAnswers, aaaaAnswers] = await Promise.all([
    dnsQuery(target, 'A'),
    dnsQuery(target, 'AAAA'),
  ]);
  const addresses = [...new Set([...aAnswers, ...aaaaAnswers]
    .filter((answer) => answer.type === 1 || answer.type === 28)
    .map((answer) => String(answer.data).replace(/\.$/, '').toLowerCase()))];
  if (!cname && addresses.length === 0) return null;
  return { hostname, cname, target, addresses, provider: providerFor(target) };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function generateYaml(domain, records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.provider + '|' + (record.cname || record.addresses.slice().sort().join('|') || record.hostname);
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  const lines = [
    '# Experimental DNS-generated circtime configuration',
    '# Verify inferred hosts and routes before publishing.',
    'settings:',
    '  page_title: ' + JSON.stringify(domain + ' Circtime'),
    '  admin_token: ""',
    '  check_interval_minutes: 15',
    '  history_limit: 720',
    '  concurrency: 4',
    '  request:',
    '    method: GET',
    '    timeout_ms: 10000',
    '    degraded_after_ms: 1500',
    '    expected_status: [200, 204, 301, 302]',
    '    degraded_status: [429, 500, 502, 503, 504]',
    '',
    'infrastructure:',
  ];

  [...groups.values()].forEach((services, index) => {
    const first = services[0];
    const shared = services.length > 1;
    const infraId = 'discovered-' + slug(first.provider + '-' + String(index + 1));
    const networkId = infraId + '-route';
    lines.push(
      '  - id: ' + JSON.stringify(infraId),
      '    server_name: ' + JSON.stringify(first.provider + ' ' + String(index + 1)),
      '    type: ' + JSON.stringify(shared ? 'Possible reverse proxy / shared edge' : first.provider),
      '    hue: ' + String(Math.round((index / Math.max(groups.size, 1)) * 360)),
      '    services:',
    );
    for (const service of services) {
      lines.push(
        '      - id: ' + JSON.stringify(slug(service.hostname)),
        '        name: ' + JSON.stringify(service.hostname),
        '        check_url: ' + JSON.stringify('https://' + service.hostname),
        '        domains: [' + JSON.stringify(service.hostname) + ']',
      );
      if (shared || service.cname) lines.push('        depends_on: [' + JSON.stringify(networkId) + ']');
    }
    if (shared || services.some((service) => service.cname)) {
      lines.push(
        '    network:',
        '      - id: ' + JSON.stringify(networkId),
        '        name: ' + JSON.stringify('Inferred route: ' + (first.cname || first.addresses.join(', '))),
      );
    } else {
      lines.push('    network: []');
    }
    lines.push('');
  });

  return lines.join('\n') + '\n';
}

const domain = cleanDomain(process.argv[2]);
const outputArg = process.argv.indexOf('--output');
const outputPath = outputArg >= 0 ? process.argv[outputArg + 1] : 'config.generated.yml';

if (!validDomain(domain)) {
  console.error('Usage: npm run probe:domain -- example.com [--output config.yml]');
  process.exitCode = 1;
} else {
  console.log('Discovering DNS names for ' + domain + '...');
  const certificateHosts = await certificateNames(domain);
  const hostnames = [...new Set([
    domain,
    ...COMMON_PREFIXES.filter(Boolean).map((prefix) => prefix + '.' + domain),
    ...certificateHosts,
  ])].slice(0, 100);
  const records = (await mapLimit(hostnames, 8, probeHost)).filter(Boolean);
  if (records.length === 0) {
    console.error('No public DNS services were discovered.');
    process.exitCode = 1;
  } else {
    await fs.writeFile(outputPath, generateYaml(domain, records), 'utf8');
    console.log('Wrote ' + outputPath + ' with ' + records.length + ' discovered hosts.');
  }
}
