# circtime

Uptime-monitor visualization dashboard — concentric circular "radar" showing infrastructure, services, and network layers with status-driven color mapping.

![Dark mode dashboard concept](https://img.shields.io/badge/theme-dark_mode-1e293b?style=flat-square)

## Concept

**Uptime Radar** — a radial visualization where:

- **Inner ring**: infrastructure providers / machines (GitHub Pages, Cloudflare, Vercel, self-hosted)
- **Middle ring**: services deployed under each infrastructure (Nextcloud, Gitea, APIs, DBs)
- **Outer ring**: network / routing layer (tunnels, reverse proxies — optional per-infra)

### Color Semantics

| Dimension  | Maps to          |
| ---------- | ---------------- |
| Hue        | Infrastructure identity (stable per provider) |
| Saturation | Uptime percentage (high uptime = vivid)       |
| Brightness | Current status (up = bright, degraded = dim, down = dark, unknown = gray) |

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` — dashboard with mock data.

## Architecture

```
src/
  types.ts           — Data model (infrastructure / service / network nodes, history)
  mockData.ts        — Generates realistic mock dataset with check history
  statusColor.ts     — HSL color mapping (hue / saturation / lightness)
  UptimeRadar.tsx    — Main concentric-ring SVG visualization
  HistoryCylinder.tsx — History "cylinder" bar visualization
  DetailsPanel.tsx   — Side panel with stats, dependencies, incidents
  ControlPanel.tsx   — Time range / sort / network layer controls
  Legend.tsx         — Color mapping legend
  Tooltip.tsx        — Hover tooltip
  App.tsx            — Dashboard shell
  App.css            — Dark mode styles
```

## Mock Data

Includes 5 infrastructure providers with 12+ services and 4 network nodes:

- **GitHub Pages** → Personal Docs, Project Readme Mirror
- **Cloudflare** → DNS, Tunnel, Reverse Proxy
- **Vercel** → Frontend App, API Route
- **Self-hosted Machine A** → Nextcloud, Minecraft, PostgreSQL, Nginx
- **Self-hosted Machine B** → Gitea, Jenkins, Docker Registry

Each node has 720 history entries (~30 days at 1h intervals) with status, latency, status codes, and messages.

## Replacing Mock Data

The data model in `types.ts` is designed for easy replacement. Swap `mockData.ts` with API calls that return the same `MonitorNode` shapes. URL fields are left empty for now — fill them with real monitoring endpoints.

## Tech Stack

- React 19 + TypeScript
- Vite
- SVG (hand-built radial geometry — no charting library)

## License

MIT
