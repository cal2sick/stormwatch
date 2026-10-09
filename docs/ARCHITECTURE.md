# Architecture

```
 NHC / NWS / USGS / NDBC / RainViewer (+ optional plugins)
                 │  (server/src/http.ts: User-Agent, ETag, timeout, backoff)
                 ▼
  server/src/poller.ts ── one job per source, own interval, last-known-good cache in data/
                 │
                 ▼
  Snapshot (storms, alerts, forecast, gauges, buoys, radar, power, threat, feeds)
                 │  GET /api/snapshot · GET /api/gis · GET /api/hazards · WebSocket /ws (push on change)
                 ▼
  web/ (React + MapLibre)  ── map, time slider, panels; served by the same server on :8787
```

## Server
- **Fastify** on `localhost:8787` (`HOST`/`PORT` override). Serves `web/dist` when built.
- **Jobs** (`poller.ts`): `nhc` (CurrentStorms.json), `nhcgis` (cone, track, watches/warnings, best track, wind-arrival isochrones, advisory text; downloaded once per advisory), `nws` (alerts for your point), `forecast` (NWS hourly + gridpoint gusts and rain), `timeline` (ATCF best track + TCM forecast/advisory + a-deck OFCL into one UTC timeline; write-once advisory snapshots in `data/advisories/`), `radar` (IEM NEXRAD scan list; RainViewer backup), `usgs` (gauges near you), `ndbc` (buoys near the storm), `coops` (tide gauges), `obs` (nearest NWS station), `cameras` (USGS HIVIS), and optional `power` / `odin` plugins.
- Jobs that need a location are disabled until `HOME_LAT`/`HOME_LON` are set. Plugins are disabled until configured.
- **Derived fields** per storm: distance and bearing from you, inside-cone check, closest approach along the forecast track and along current motion, tropical-storm wind arrival from NHC isochrones. All labeled estimates.
- **Threat engine** (`threat.ts`): pure rules over alerts + nearest storm, with step-down hysteresis. `SET LOCATION` when no location; `DATA STALE` when every feed is old.
- **Cache** (`cache.ts`): last good snapshot and GIS on disk in `data/` (git-ignored) so restarts and outages still show the last state.

## Web
- `useSnapshot` (WebSocket with reconnect + localStorage copy), `useGis` (re-fetches geometry when `gisVersion` changes).
- **Time slider** (`hud/TimeMachine.tsx` + pure `stormTime.ts` / `track.ts` / `timeline.ts`, data from `/api/timeline` via `useTimeline`): merges NHC best track, the latest NHC position and the selected advisory's forecast into one UTC timeline (by valid time), interpolates wind radii and the 2026 cone circle, interpolates along great circles, snaps to 15 min and forecast hours, and drives the main storm marker on the map.
- Map (`map/MapView.tsx`): OpenFreeMap dark basemap with a bare fallback, NHC layers, radar frames, point layers.

## Design principles
Function first, readable text, sources and timestamps everywhere, official sources win.
