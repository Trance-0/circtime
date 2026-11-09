# Verification

## Common mistakes

- Transparent embed CSS and a null WebGL scene background can reveal an
  unexpected parent background even when the widget requests dark mode.
- Keep private config/history files out of the public build; use monitor exports.

## 2026-11-08

- Checked local status (clean before work), fetched origin and fast-forward
  checked remote main. The local embed commit already contains remote main;
  no remote code changes were missing. The uptime-history branch advanced.
- Added explicit embed backdrops and optional red/yellow/green 48-hour coloring.
- Split 3D helpers to keep changed source files under 1000 lines.
- Typecheck, production build and four Node tests passed. Public Chromium
  confirmed black/white embed backgrounds, both with a rendered canvas.
- Existing monitor configuration, history, mounts and service identity preserved.
