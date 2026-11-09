# circtime

A React + TypeScript uptime-monitor visualization dashboard. circtime renders infrastructure, services, and optional network layers as a concentric uptime radar.

The repository is template-ready. Keep the real root `config.yml` local or store its complete YAML contents in the GitHub Actions secret `CONFIG`. GitHub Actions checks those sites every 15 minutes, keeps one year of history in a dedicated state branch, and deploys the static dashboard to GitHub Pages.

## How It Works

- `config.yml` is the first-choice source of truth. When it is absent, the scripts read the multiline `CONFIG` environment variable used by GitHub Actions.
- `config.sample.yml` is the tracked, sanitized starting point. The real `config.yml` is ignored by Git.
- `npm run check:sites` pings every configured URL and writes `public/uptime-history.json` plus `public/uptime-latest.json`.
- `npm run build` generates `public/circtime-config.json` from `config.yml`, builds the Vite app, and copies the JSON files into `dist`.
- `.github/workflows/pages.yml` restores prior history from the `uptime-history` branch, runs checks, persists the updated history as compressed state, and deploys `dist` with the official GitHub Pages Actions workflow.
- GitHub Pages serves the app and the JSON history files, so no separate backend is required.

Blank `url: ""` entries are allowed. They appear as `unknown` until a URL is configured.

## Local Development

```bash
npm install
npm run config:init
npm run dev
```

Open `http://localhost:5173`.

Useful commands:

```bash
npm run check:sites
npm run build
npm run preview
```

## Deploy With GitHub Actions

1. Create a repository from this template and clone it.
2. Copy `config.sample.yml` to `config.yml`, then replace the sample infrastructure and URLs. The real file is ignored and must not be force-added to Git.
3. Set `settings.admin_token` to a long random value. If it is empty, the workflow generates a token and exposes it as the seven-day `circtime-admin-token` workflow artifact.
4. In GitHub, open **Settings -> Secrets and variables -> Actions -> New repository secret**.
5. Name the secret `CONFIG`. Paste the complete contents of your local `config.yml` as the secret value.
6. Open **Settings -> Pages** and set **Source** to **GitHub Actions**.
7. Open **Actions -> Monitor and deploy GitHub Pages -> Run workflow**.
8. Open the URL emitted by the `deploy` job. A repository named `<username>.github.io` deploys at `https://<username>.github.io/`; other repositories deploy at `https://<username>.github.io/<repository>/`.

At runtime, `config.yml` takes precedence when it exists in the checkout. Otherwise the workflow reads `secrets.CONFIG`. The workflow fails without either source rather than publishing sample or synthetic deployment data.

The workflow also runs on every push to `main` and every 15 minutes by default.

## Use As A Template Repository

Repository owners should enable the template flag once:

1. Open **Settings -> General**.
2. Check **Template repository**.
3. Save.

After that, other users can click **Use this template**, create their own copy, prepare `config.yml`, store it as `CONFIG`, enable Pages, and run the workflow.

## Production And Dev Data

- `main` never synthesizes monitoring history. Missing checks remain `unknown` until GitHub Actions records real results.
- `dev` is based directly on `main` and adds a prefilled sample `config.yml` plus synthetic uptime history for visual testing.
- Do not merge the dev fixture files into `main` or use them as deployment history.

After committing changes to `main`, update `dev` without copying its fixture data back into production. If a local ignored `config.yml` exists on `main`, move it outside the worktree before running the command because `dev` supplies its own tracked fixture config.

```bash
npm run sync:dev
```

The sync command merges `main`, verifies that the three dev fixtures are unchanged, and fails if `dev` differs from `main` anywhere else.

## Editing `config.yml`

`config.yml` has two top-level sections: `settings` and `infrastructure`.

### Global Settings

```yaml
settings:
  page_title: "My Status Radar"
  # Prefer the CIRCTIME_ADMIN_TOKEN GitHub secret for public repos.
  # Use this YAML value only for private repos or local deployments.
  admin_token: ""
  show_disk_outline: true
  max_timeout_ms: 5000
  check_interval_minutes: 15
  history_retention_days: 365
  history_limit: 35040
  concurrency: 4
  request:
    method: GET
    timeout_ms: 5000
    degraded_after_ms: 1500
    expected_status: [200, 204, 301, 302]
    degraded_status: [429, 500, 502, 503, 504]
```

Fields:

- `page_title`: Browser title and title shown in the Esc settings menu.
- `admin_token`: Token used to encrypt the admin debug bundle. Keep it inside the ignored local file and the `CONFIG` secret. The optional `CIRCTIME_ADMIN_TOKEN` secret overrides this value.
- `show_disk_outline`: Shows or hides the concentric guides and component edge lines.
- `max_timeout_ms`: Admin-configured upper latency and request-timeout bound. At the default `5000`, samples at or above five seconds use the minimum render lightness.
- `check_interval_minutes`: Check cadence used by circtime. The included GitHub Actions schedule runs every 15 minutes.
- `history_retention_days`: Removes checks older than this many days. The template keeps the most recent 365 days.
- `history_limit`: Safety cap per node. `35040` is one check every 15 minutes for 365 days (`4 x 24 x 365`). Keep this value at least as large as the number of samples expected during the retention period.
- `concurrency`: Number of URLs checked in parallel.
- `method`: HTTP method for checks. Use `GET` unless your target reliably supports `HEAD`.
- `timeout_ms`: Per-request timeout. It is capped by `settings.max_timeout_ms`.
- `degraded_after_ms`: A successful response slower than this becomes `degraded`.
- `expected_status`: HTTP statuses that count as healthy.
- `degraded_status`: HTTP statuses that count as degraded instead of down.

### Add Or Edit A Site

Each infrastructure owns services and optional network nodes. Fill in `url` for anything you want GitHub Actions to check.

```yaml
infrastructure:
  - id: github-pages
    name: GitHub Pages
    hue: 210
    # Optional: 1 = largest padding/smallest section, 5 = smallest padding/largest section.
    # Omit render_padding to use deterministic-random sizing from the config hash.
    render_padding: 3
    url: "https://status.github.com/api/status.json"
    services:
      - id: personal-docs-site
        name: Personal Docs Site
        render_padding: 5
        url: "https://example.github.io/docs/"
        depends_on: []
      - id: project-readme-mirror
        name: Project Readme Mirror
        url: "https://example.github.io/readme/"
        depends_on: []
    network: []
```

Required fields:

- `id`: Stable unique identifier. Use lowercase letters, numbers, and hyphens. Do not change it after history exists unless you want a new history series.
- `name`: Display name in the dashboard.
- `url`: URL to ping. Leave as `""` to keep the node configured but unchecked.
- `hue`: Optional color hue from `0` to `359`. Infrastructures, services, and network nodes can each set their own hue; services without a hue are spread across the palette.
- `services`: List of deployed services under the infrastructure.
- `network`: Optional routing/proxy layer. Use `network: []` when there is none.
- `depends_on`: List of other node IDs this node depends on.

Optional render sizing:

- `render_padding`: May be set on infrastructure, service, or network nodes. Use `1` for the largest padding and smallest visual section, or `5` for the smallest padding and largest section. Leave it out to let circtime generate a deterministic-random value from the config hash and node ID.
- Example: set `render_padding: 5` on `nextcloud` to keep it visually prominent, and `render_padding: 1` on `portainer` to keep it compact while all omitted nodes remain random.

### Add A Network Layer

```yaml
network:
  - id: cloudflare-tunnel
    name: Cloudflare Tunnel
    render_padding: 4
    url: "https://tunnel-health.example.com/health"
    depends_on: [cloudflare-dns]
  - id: cloudflare-reverse-proxy
    name: Reverse Proxy
    url: "https://proxy.example.com/health"
    depends_on: [cloudflare-dns, cloudflare-tunnel]
```

Network nodes render as partial outer arcs only for the infrastructure that defines them.

### Override Request Settings For One Node

Use a node-level `request` block when a single endpoint has different expectations.

```yaml
services:
  - id: api-route
    name: API Route
    url: "https://api.example.com/healthz"
    depends_on: []
    request:
      method: GET
      timeout_ms: 3000
      degraded_after_ms: 800
      expected_status: [200]
      degraded_status: [429, 503]
```

### Common Examples

Ping a normal website:

```yaml
url: "https://example.com/"
expected_status: [200, 301, 302]
```

Ping a health endpoint:

```yaml
url: "https://api.example.com/health"
expected_status: [200]
```

Track a private service without checking it yet:

```yaml
url: ""
```


## Embed Mode

Append `?embed=1` to render only the radar as a background widget:

```text
index.html?embed=1&theme=system|light|dark&fit=contain|cover&refresh=60
```

- `theme`: `system` (default) follows `prefers-color-scheme`. A parent frame can switch it at runtime with `iframe.contentWindow.postMessage({ type: "circtime-theme", theme: "light" }, origin)`. Messages are accepted only from the parent window on the same origin, or from the origin passed as `parent_origin=`.
- `fit`: `contain` (default) keeps the whole disc in view; `cover` fills the longer side.
- `refresh`: seconds between data refreshes (default 60, minimum 15). Refreshes re-read `circtime-config.json` and `uptime-latest.json` and append new results in memory; the full history is fetched once per load or when the config changes.
- In embed mode the page and canvas are transparent, settings, tooltips and panels are not rendered, and the canvas ignores input. Apply opacity and `pointer-events: none` on the parent iframe.

The build uses relative asset paths (`base: './'`), so it can be served from any sub-path such as `/embed/circtime/` (keep the trailing slash). It loads only same-origin files: no fonts, CDNs, analytics, inline scripts, inline styles or `data:` URIs, so it runs under `Content-Security-Policy: default-src 'self'`. The optional DNS config generator in the settings menu calls public DNS and certificate-transparency APIs; it is not available in embed mode and is blocked by such a CSP.

## Public-Safe Output

For dashboards shown to anonymous viewers, publish sanitized data only:

```bash
CIRCTIME_PUBLIC_SAFE=1 npm run build   # no admin bundle; config has names, ids, groups only
npm run check:sites
npm run export:public -- dist          # writes sanitized JSON into dist and verifies it
```

`scripts/public-safe.mjs` keeps display names, ids, groups, dependency ids, status, latency, HTTP status codes and epoch timestamps. It drops URLs, hosts, IPs, ports, domains, raw check messages and admin data, and refuses to write a file that still matches a URL, loopback, IPv4, `host:port`, the admin token or any configured host.

## Self-Hosted Monitor (Docker Compose)

`deploy/compose.yml` runs a long-lived monitor that checks the configured URLs on `check_interval_minutes` and publishes a public-safe build:

```bash
cp config.sample.yml config.yml && chmod 600 config.yml   # then edit
mkdir -p /srv/circtime/state /srv/circtime/dist && chmod 700 /srv/circtime/state
echo "CIRCTIME_DATA=/srv/circtime" > deploy/.env           # ignored by Git
docker compose -f deploy/compose.yml up -d
```

- Host networking, so loopback health URLs work. The container publishes and listens on no ports; serve `${CIRCTIME_DATA}/dist` read-only from your existing web server.
- Runs as UID/GID 1000 (`CIRCTIME_UID`/`CIRCTIME_GID`) with a read-only root filesystem, no capabilities, and rotated logs.
- `config.yml` is mounted read-only and never copied into the served directory. Raw history, `node_modules` and the build workspace stay in `${CIRCTIME_DATA}/state`, so history survives restarts.
- The static app is rebuilt only when the source or `config.yml` changes; the sanitized JSON is rewritten atomically after every check.
- The health check reports healthy while check cycles keep completing.

## Experimental DNS Config Generator

Open the ESC menu and enter a root domain under **DNS config generator**. The analyzer runs in a separate Web Worker, queries public DNS and certificate-transparency records, groups shared CNAME/IP routes, and generates a downloadable `config.yml`. Treat reverse-proxy and host-machine classifications as heuristics and review the file before deployment.

A removable command-line version is also available:

```powershell
node experimental/probe-domain.mjs example.com --output config.yml
```

The CLI discovers certificate hostnames, probes CNAME/A/AAAA records, groups likely shared edges or reverse proxies, and writes a standalone configuration. It does not modify the active dashboard configuration unless `--output config.yml` is explicitly used.
## Architecture

```text
src/
  types.ts             Data model
  configuredData.ts    Converts generated config/history JSON into monitor nodes
  dataStore.ts         Runtime data source used by visualization components
  statusColor.ts       HSL color mapping
  UptimeRadar.tsx      Main concentric-ring SVG visualization
  HistoryCylinder.tsx  History visualization
  DetailsPanel.tsx     Side panel with status and incidents
  ControlPanel.tsx     Time range, network, and sort controls
  Legend.tsx           Color mapping legend
  Tooltip.tsx          Service and time-slice inspector
  AnalysisPanel.tsx    Public dependency diagnosis window
  DomainProbe.tsx      Experimental DNS config UI
  domainProbe.worker.ts Isolated DNS topology analyzer
  App.tsx              Dashboard shell
```

```text
scripts/
  yaml-lite.mjs        Small YAML reader for the documented config shape
  config-utils.mjs     Shared config normalization
  build-config.mjs     Generates public/circtime-config.json
  check-sites.mjs      Pings URLs and writes uptime history JSON
```

## Visualization Semantics

| Dimension | Meaning |
| --- | --- |
| Hue | Globally unique service identity; infrastructure hues remain stable |
| Saturation | Uptime percentage |
| Brightness | Current status: up is bright, degraded is dim, down is dark, unknown is gray |

## License

MIT

## Embed theme and status colors

`?embed=1&theme=dark` paints a black backdrop; `theme=light` paints white.
Parent theme messages still work when `parent_origin` matches. Add
`monochrome=1` for three status colors: red for unavailable/currently down or
all failed observations, yellow for any error during the last 48 hours, and
green otherwise. Normal identity/uptime colors remain the default.
