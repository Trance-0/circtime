/// <reference lib="webworker" />

type DnsAnswer = { name: string; type: number; data: string };
type DnsResponse = { Status?: number; Answer?: DnsAnswer[] };

interface ProbeRecord {
  hostname: string;
  cname?: string;
  addresses: string[];
  provider: string;
}

const COMMON_PREFIXES = [
  '', 'www', 'api', 'app', 'admin', 'auth', 'blog', 'cdn', 'cloud', 'dashboard',
  'docs', 'git', 'grafana', 'home', 'immich', 'jenkins', 'jellyfin', 'mail',
  'mc', 'minecraft', 'nas', 'nextcloud', 'panel', 'portainer', 'status', 'vpn',
];

function cleanDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '');
}

function validDomain(value: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}

function cleanDnsValue(value: string): string {
  return value.replace(/^"|"$/g, '').replace(/\.$/, '').toLowerCase();
}

function providerFor(target: string, addresses: string[]): string {
  const value = target.toLowerCase();
  if (/cloudflare|pages\.dev/.test(value)) return 'Cloudflare edge';
  if (/vercel|vercel-dns/.test(value)) return 'Vercel';
  if (/github\.io|github\.com/.test(value)) return 'GitHub Pages';
  if (/netlify/.test(value)) return 'Netlify';
  if (/azure|microsoftonline|trafficmanager/.test(value)) return 'Microsoft Azure';
  if (/amazonaws|cloudfront/.test(value)) return 'AWS';
  if (/googlehosted|googleusercontent|ghs\.google/.test(value)) return 'Google';
  if (/fastly/.test(value)) return 'Fastly';
  return addresses.length > 0 ? 'Public host' : 'DNS route';
}

async function dnsQuery(name: string, type: 'CNAME' | 'A' | 'AAAA'): Promise<DnsAnswer[]> {
  const url = 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=' + type;
  const response = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  const payload = await response.json() as DnsResponse;
  return payload.Status === 0 ? payload.Answer ?? [] : [];
}

async function certificateNames(domain: string): Promise<string[]> {
  try {
    const response = await fetch(
      'https://crt.sh/?q=' + encodeURIComponent('%.' + domain) + '&output=json',
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return [];
    const rows = await response.json() as Array<{ name_value?: string }>;
    return rows
      .flatMap((row) => (row.name_value ?? '').split('\n'))
      .map((name) => cleanDomain(name.replace(/^\*\./, '')))
      .filter((name) => name === domain || name.endsWith('.' + domain));
  } catch {
    return [];
  }
}

async function probeHost(hostname: string): Promise<ProbeRecord | null> {
  try {
    const cnameAnswers = await dnsQuery(hostname, 'CNAME');
    const cname = cnameAnswers.find((answer) => answer.type === 5)?.data;
    const target = cname ? cleanDnsValue(cname) : hostname;
    const [aAnswers, aaaaAnswers] = await Promise.all([
      dnsQuery(target, 'A'),
      dnsQuery(target, 'AAAA'),
    ]);
    const addresses = [...aAnswers, ...aaaaAnswers]
      .filter((answer) => answer.type === 1 || answer.type === 28)
      .map((answer) => cleanDnsValue(answer.data));
    if (!cname && addresses.length === 0) return null;
    return {
      hostname,
      cname: cname ? cleanDnsValue(cname) : undefined,
      addresses: [...new Set(addresses)],
      provider: providerFor(target, addresses),
    };
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'host';
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function generateConfig(domain: string, records: ProbeRecord[]) {
  const groups = new Map<string, ProbeRecord[]>();
  for (const record of records) {
    const route = record.cname || record.addresses.slice().sort().join('|') || record.hostname;
    const key = record.provider + '|' + route;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const infrastructures = [...groups.entries()].map(([key, services], index) => {
    const first = services[0];
    const sharedRoute = services.length > 1;
    const routeName = first.cname || first.addresses.join(', ') || first.hostname;
    const infraId = 'discovered-' + slug(first.provider + '-' + String(index + 1));
    const networkId = infraId + '-route';
    return {
      key,
      id: infraId,
      name: first.provider + ' ' + String(index + 1),
      type: sharedRoute ? 'Possible reverse proxy / shared edge' : first.provider,
      hue: Math.round((index / Math.max(groups.size, 1)) * 360),
      routeName,
      sharedRoute,
      networkId,
      services,
    };
  });

  const lines = [
    '# Experimental DNS-generated circtime configuration',
    '# Verify inferred hosts and routes before publishing.',
    'settings:',
    '  page_title: ' + yamlString(domain + ' Circtime'),
    '  admin_token: ""',
    '  check_interval_minutes: 15',
    '  history_retention_days: 365',
    '  history_limit: 35040',
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

  for (const infra of infrastructures) {
    lines.push(
      '  - id: ' + yamlString(infra.id),
      '    server_name: ' + yamlString(infra.name),
      '    type: ' + yamlString(infra.type),
      '    hue: ' + String(infra.hue),
      '    services:',
    );
    for (const service of infra.services) {
      lines.push(
        '      - id: ' + yamlString(slug(service.hostname)),
        '        name: ' + yamlString(service.hostname),
        '        check_url: ' + yamlString('https://' + service.hostname),
        '        domains: [' + yamlString(service.hostname) + ']',
      );
      if (infra.sharedRoute || service.cname) lines.push('        depends_on: [' + yamlString(infra.networkId) + ']');
    }
    if (infra.sharedRoute || infra.services.some((service) => service.cname)) {
      lines.push(
        '    network:',
        '      - id: ' + yamlString(infra.networkId),
        '        name: ' + yamlString('Inferred route: ' + infra.routeName),
      );
    } else {
      lines.push('    network: []');
    }
    lines.push('');
  }

  return {
    yaml: lines.join('\n') + '\n',
    summary: {
      hostCount: records.length,
      cnameCount: records.filter((record) => record.cname).length,
      infrastructureCount: infrastructures.length,
      reverseProxyGroups: infrastructures.filter((infra) => infra.sharedRoute).length,
    },
  };
}

self.onmessage = async (event: MessageEvent<{ domain: string }>) => {
  const domain = cleanDomain(event.data.domain);
  if (!validDomain(domain)) {
    self.postMessage({ type: 'error', message: 'Enter a valid root domain.' });
    return;
  }

  try {
    self.postMessage({ type: 'progress', message: 'Discovering DNS names' });
    const discovered = await certificateNames(domain);
    const candidates = new Set([
      domain,
      ...COMMON_PREFIXES.filter(Boolean).map((prefix) => prefix + '.' + domain),
      ...discovered,
    ]);
    const hostnames = [...candidates].slice(0, 80);

    self.postMessage({ type: 'progress', message: 'Probing DNS routes' });
    const probed = await mapLimit(hostnames, 6, probeHost);
    const records = probed.filter((record): record is ProbeRecord => record !== null);
    if (records.length === 0) throw new Error('No public DNS services were discovered.');

    self.postMessage({
      type: 'complete',
      domain,
      ...generateConfig(domain, records),
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Domain analysis failed.',
    });
  }
};

export {};
