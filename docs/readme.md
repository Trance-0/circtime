# Circtime embed behavior

Circtime renders the same uptime data standalone and inside the agent
dashboard. The dashboard serves the public-safe monitor build through a
read-only bind mount. Query parameters select embed mode, fixed/system theme,
fit and monochrome status colors. The monitor retains its private configuration
and history outside the served directory and rebuilds when source changes.

The 3D geometry/history helpers live in `src/radarGeometry.ts`; the React
renderer remains in `src/UptimeRadar3D.tsx`. Dark embeds paint black and light
embeds paint white. `monochrome=1` uses red/yellow/green status semantics with
a 48-hour failure window, tested at the exact boundary.
