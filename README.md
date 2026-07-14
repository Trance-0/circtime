# circtime

A React + TypeScript uptime-monitor visualization dashboard. circtime renders infrastructure, services, and optional network layers as a concentric uptime radar.

The repository is template-ready: users only edit the root `config.yml` to define their own monitored sites. GitHub Actions checks those URLs every 15 minutes, keeps one year of history in a dedicated state branch, and deploys the static dashboard to GitHub Pages.

## How It Works

- `config.yml` is the source of truth for infrastructure, services, network layers, URLs, dependencies, hues, render sizing, and request settings.
- `npm run check:sites` pings every configured URL and writes `public/uptime-history.json` plus `public/uptime-latest.json`.
- `npm run build` generates `public/circtime-config.json` from `config.yml`, builds the Vite app, and copies the JSON files into `dist`.
- `.github/workflows/pages.yml` restores prior history from the `uptime-history` branch, runs checks, persists the updated history as compressed state, and deploys `dist` with the official GitHub Pages Actions workflow.
- GitHub Pages serves the app and the JSON history files, so no separate backend is required.

Blank `url: ""` entries are allowed. They appear as `unknown` until a URL is configured.

## Local Development

```bash
npm install
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

1. Push this repo to GitHub.
2. Open the repository settings.
3. Go to **Pages**.
4. Set **Source** to **GitHub Actions**.
5. Open **Actions -> Monitor and deploy GitHub Pages -> Run workflow**.
6. After deployment, open the URL shown by the `deploy` job. A repository named `<username>.github.io` deploys at `https://<username>.github.io/`; other repositories deploy at `https://<username>.github.io/<repository>/`.

The workflow also runs on every push to `main` and every 15 minutes by default.

## Use As A Template Repository

Repository owners should enable the template flag once:

1. Open **Settings -> General**.
2. Check **Template repository**.
3. Save.

After that, other users can click **Use this template**, create their own copy, edit only `config.yml`, enable Pages, and run the workflow.

## Editing `config.yml`

`config.yml` has two top-level sections: `settings` and `infrastructure`.

### Global Settings

```yaml
settings:
  page_title: "My Status Radar"
  # Prefer the CIRCTIME_ADMIN_TOKEN GitHub secret for public repos.
  # Use this YAML value only for private repos or local deployments.
  admin_token: ""
  check_interval_minutes: 15
  history_retention_days: 365
  history_limit: 35040
  concurrency: 4
  request:
    method: GET
    timeout_ms: 10000
    degraded_after_ms: 1500
    expected_status: [200, 204, 301, 302]
    degraded_status: [429, 500, 502, 503, 504]
```

Fields:

- `page_title`: Browser title and title shown in the Esc settings menu.
- `admin_token`: Optional token used to encrypt the admin debug bundle. Prefer the `CIRCTIME_ADMIN_TOKEN` GitHub secret for public repos; a token committed in YAML is visible to anyone who can read the repo.
- `check_interval_minutes`: Check cadence used by circtime. The included GitHub Actions schedule runs every 15 minutes.
- `history_retention_days`: Removes checks older than this many days. The template keeps the most recent 365 days.
- `history_limit`: Safety cap per node. `35040` is one check every 15 minutes for 365 days (`4 x 24 x 365`). Keep this value at least as large as the number of samples expected during the retention period.
- `concurrency`: Number of URLs checked in parallel.
- `method`: HTTP method for checks. Use `GET` unless your target reliably supports `HEAD`.
- `timeout_ms`: A request that exceeds this becomes `down`.
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
  mockData.ts          Fallback generated demo data
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
