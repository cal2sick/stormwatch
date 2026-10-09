# AGENTS.md: guide for coding agents

Read this file, then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md), before changing anything.

## What this is
A self-hosted, localhost-only live hurricane tracker. A Node server polls free public feeds, builds one snapshot, and pushes it over a WebSocket to a React + MapLibre web app. The core feature is the time slider: live position, past track and the NHC forecast, interpolated, on one timeline.

## Stack
- Node 20+, TypeScript (strict), npm workspaces: `server/` and `web/`.
- Server: Fastify 5, `@fastify/websocket`, `@fastify/static`, run with `tsx`. `shpjs` reads NHC shapefiles, `but-unzip` reads KMZ.
- Web: Vite 5, React 18, MapLibre GL 4 (OpenFreeMap basemap, RainViewer radar tiles).
- Tests: Vitest in `server/test/` (they also import pure modules from `web/src/`).

## Commands
```bash
npm install          # root; installs both workspaces
npm start            # build web + serve web and API on http://localhost:8787
npm run dev          # hot reload (API :8787 + Vite :5173)
npm test             # unit tests, offline, must pass
npm run typecheck    # must pass before every commit
npm run build        # must pass before every PR
npm run smoke        # live fetch of every enabled feed (needs internet; not run in CI)
```
Health check: `curl http://localhost:8787/api/health` -> `{"ok":true,...}`. Full state: `/api/snapshot`, geometry: `/api/gis`, live push: `/ws`.

## Layout
- `server/src/config.ts`: env + `config/thresholds.json` loading. Location only from `HOME_LAT`/`HOME_LON`.
- `server/src/poller.ts`: job list, scheduling, backoff, snapshot rebuild, derived per-storm fields.
- `server/src/sources/*.ts`: one file per upstream source; each exports a URL builder and a `fetchX()` that returns `{ data, sourceTime }`.
- `server/src/http.ts`: the only place that calls upstream `fetch` (User-Agent, ETag/Last-Modified, timeout, Retry-After).
- `server/src/threat.ts`: pure threat rules. `geo.ts`: pure geo math.
- `web/src/track.ts`, `web/src/timeline.ts`: pure slider math (interpolation, snapping, advice windows). The map and the readout must both use these so they never disagree.
- `web/src/hud/*`: panels. `web/src/map/*`: map and layers.
- `server/src/types.ts` and `web/src/types.ts` are copies. Change both together.

## Hard rules
1. **Privacy.** Never commit personal data: names, emails, home coordinates, addresses, school or employer names, machine paths. Location comes only from the user's `.env`. Tests use arbitrary or public city coordinates. No telemetry or analytics of any kind.
2. **No hard-coded storm data.** Names, ids, positions, advisory numbers and URLs all come from live feeds. Pick a storm by distance or user choice.
3. **Every panel shows its source and the source's own timestamp**, with a staleness color (amber after 2x poll interval, red after 6x).
4. **Official text is verbatim.** Never rewrite or soften NWS/NHC alert text.
5. **Keep last-known-good data.** A failed fetch marks the feed stale; it never blanks a panel.
6. **Poll politely.** One server poller for all clients. Use `config/thresholds.json` intervals. Respect ETag/Last-Modified and Retry-After; exponential backoff to 30 min. All requests go through `http.ts`.
7. **Free and open only.** No API keys, no paid services, no scraping behind logins, CAPTCHAs or embedded keys.
8. **The safety banner stays** on every layout. Distances and arrival times are labeled estimates.
9. **Localhost by default.** Don't change the default bind host.
10. Plain, readable English in the UI: no unexplained abbreviations, units spelled out.

## Add a data source (step by step)
1. Confirm it is free, public, keyless and allowed to be polled. Note its terms and update interval in `docs/DATA-SOURCES.md`.
2. Create `server/src/sources/<name>.ts` exporting a URL builder and `fetch<Name>(home?)` that uses `getJson`/`getText` from `http.ts` and returns `{ <data>, sourceTime }` (the source's own timestamp if it has one).
3. Add the data shape to `server/src/types.ts` **and** `web/src/types.ts`, and a default to `EMPTY` in `poller.ts`.
4. Add a job in `poller.ts` (`key`, `source`, `url`, `run`, and `enabled` if it needs a location or is an opt-in plugin), add its key to the `order` list, and its poll interval to `config/thresholds.json` `pollSeconds`.
5. Optional plugins: read their settings from `.env` in `config.ts`, default to off, and document them in `.env.example` and `docs/DATA-SOURCES.md`.
6. Add a parser test in `server/test/` with a small inline fixture (no live network in tests).
7. Show it in a panel or map layer with a source line and timestamp.
8. Run `npm run typecheck && npm test && npm run build`, then `npm start` and check it live.

## Conventions
- Times are stored as ISO UTC. Display uses `web/src/time.ts` (currently Eastern Time with an "ET" label, matching NHC).
- Small files, one component per file. Pure logic lives outside React components so it can be tested.
- Branch + PR for every change; keep PRs small; CI must be green.
