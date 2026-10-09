# Changelog

## v0.7.0 (2026-10-09, branch `preview`)

The futuristic revamp, auto-update, and new "when does it hit me" tools. Shipped in small tested commits.

- **Auto-update: `npm run start:auto`.** A small Node supervisor (no extra installs) runs the app and checks the branch's upstream every 2 minutes (`STORMWATCH_UPDATE_SECONDS`). New commit: `git pull --ff-only`, `npm install` only when a `package.json`/`package-lock.json` changed, rebuild, restart. It never resets or overwrites your changes: a dirty tree (other than npm's `package-lock.json` churn, which is discarded) or a diverged branch is logged and skipped. The server restarts itself with backoff if it crashes.
- **Futuristic revamp (map first).** The map fills the screen; everything else floats over it as glass cards (translucent, blurred, thin lines, soft shadows). Inter for words and JetBrains Mono for numbers (both bundled, no font CDN), deep near-black base with one ice-cyan accent, glow only on live and important things. Retro grid/scanline overlay removed.
  - Slim top bar: storms as pills, the threat level as one glowing pill ("Threat RED" with the other levels as dots), Live dot, Voice / Alerts / Low data / More panels, clock. A menu button folds the whole side panel away.
  - Big time dock at the bottom of the map: large time readout, Play, a thick touch-friendly slider (past = blue, now = red tick, forecast = amber stripes) with a glowing thumb, forecast-point jumps and Back to live. The dock border turns red / blue / amber for live / past / forecast.
  - Live / Past / Next 3 hours as one segmented glass control.
  - Icon layer menu on the right (Storm path, Radar, Alerts, Satellite, Wind arrival, Outages, Rivers & buoys, Cameras, Places, Night lights; Standard / Hazards view; Center home). Four data layers on by default (storm, radar, alerts, outages). Collapses to icons.
  - The storm is the familiar hurricane symbol, colored by Saffir-Simpson category and slowly turning (still when "reduce motion" is set). Home is a cyan crosshair.
  - Every card folds (tap its title; remembered per card). Detail cards (station observations, tornado/flood list, threat details, place lookup) start folded.
  - The map centers and fits into the area the cards leave free, so the storm is never under the dock or the side panel.
- **Pages reload themselves.** New `/api/version` (version, git sha, web build time). The page polls it every 20 s and, when it changes, shows "Updated to vX, reloading" for 3 s and reloads.

## v0.6.1 (2026-10-09, branch `preview`)

Live radar that feels live, Change home, FSU default, and a real tap-on-map card.

- **Tap card fix.** Root cause: there was no lookup for the tapped point at all; a tap only opened the popup of whatever big polygon was under it (a tornado watch or an outage region), and since one polygon covers the whole area, every tap showed the same card. Now each tap opens a card for that exact point from the new `/api/point`: OpenStreetMap place name, NWS gridpoint wind, gusts, rain chance and rain amount at the slider time, NWS alerts in effect there at that time, distance and direction to the storm at that time, nearest outages and the outage area. Every value has its source and time, or says "unavailable" (never another point's data). Debounced, the old request is cancelled on a new tap, cached per 0.01 deg.
- **Close buttons everywhere.** Every map popup has a tap-sized ✕, Esc closes the topmost popup or the tap card, a tap on empty map closes the tap card, and the radar box can be hidden and reopened ("Radar ▸") like the map key.
- **Live radar.** The server checks IEM for the newest NEXRAD scan every 60 s (was 5 min) and uses it as soon as its tiles exist; Live shows "Latest radar scan: HH:MM ET (X min ago)" with a pulsing LIVE dot and advances by itself.
- **Smooth live radar (estimate)**, on by default with an off switch: the rain motion is measured from the last two scans (cross-correlation of two downsampled scans; NHC storm motion as fallback), and the latest scan slides along it until the next real scan arrives, then snaps to it. Labeled "Latest scan HH:MM ET + estimated motion (X min)". Covers ~1,100 mi around your home; turn it off for the full national radar.
- **Change home.** Search or click the map; saved only in this browser, overrides `.env`; "Use Florida State University" and "Reset to default". Distance, threat, wind, alerts, outages, feed and the safety banner all follow it.
- **Default home is Florida State University** when there is no browser home and no `HOME_LAT`/`HOME_LON` (`HOME_DEFAULT=off` restores storms-only mode).
- New `/api/point` and `/api/radar-motion` routes, new tests (point card with two different points, cache per 0.01 deg, time filtering, unavailable instead of fallback; radar motion; FSU default). Opt-in live test: `LIVE=1 npx vitest run test/pointCard.test.ts` (Tallahassee vs Pensacola vs Miami).

## v0.6.0 (2026-10-09, branch `preview`)

Power outage upgrade, modeled on how the best outage maps present the numbers (design ideas only; no outside data copied).

- **Headline for the selected place:** big "customers out" and "% out of N customers" for the live utility feed that serves it, "updated X min ago" from the utility's own feed time (amber OUT OF DATE after 15 minutes), and which utilities near it are not counted because they have no free live feed.
- **Map shading by % out with one legend (0 / 10 / 30 / 60 / 100%):** City of Tallahassee Utilities regions (the utility's own region shapes; shade = share of all the utility's customers) and county outlines from ORNL ODIN (shaded only where ODIN gives meters served, otherwise dashed outline + count). Click a region or county for details.
- **Per-utility table:** out, customers served, % out, estimated restore (or how many estimates have already passed), source and time, with a link to each utility's map. Served counts are from the U.S. Energy Information Administration Form EIA-861 (2024), whole-utility Florida totals, and labeled as such.
- **24-hour sparkline** from the app's own checks every 3 minutes, saved to `data/outage-history.jsonl` (totals only, kept 7 days): peak, and rising / restoring / steady versus an hour ago.
- **Clustered outage points** for the whole City of Tallahassee Utilities area: grouped circles sized by customers with the customer total; click to zoom in.
- **Compare on PowerOutage.us** link (link only; their numbers are never used).
- **Map key** is now collapsed by default to a small "Map key" button so it never covers the bottom-right of the map; open it to see the legend and sources, "hide" to close. The choice is remembered on this device.
- New `/api/outage-areas` route. 13 new tests (region matching, ODIN grouping, % math, ETR summary, history parsing, headline and table rules, ramp, sparkline and trend).

## v0.5.0 (2026-10-09, branch `preview`)

Radar fix, live vs forecast made obvious, forecast radar, and a local updates feed.

- **Radar fix.** Moving the time slider 10 to 30 minutes from now used to snap back to "now" (the slider pulled anything within 40 minutes to live), and any future time showed no radar at all, so the map looked blank or stuck. Frames were also switched before their tiles had loaded. Now the slider moves in 5-minute steps near now, every past time shows the matching 5-minute NEXRAD scan, and a new radar frame only fades in once it has loaded (the previous one stays on screen until then). The map always says which radar time it shows, with a LIVE / PAST / FORECAST badge and a loading note.
- **Radar: last 2 hours** play/pause loop (and "Play forecast radar" in forecast mode).
- **Live now | Past | Next 3 hours (forecast)** buttons at the top of the map, with quick steps (-2 h to -10 min, +30 to +180 min). Forecast times get a striped overlay and a "FORECAST, not observed" label. The slider track is colored: blue = past, red tick = now, amber stripes = forecast.
- **Forecast radar, 0 to 3 hours:** NOAA HRRR model simulated radar (Iowa Environmental Mesonet tiles), with the model run time and lead time shown. It is a computer model, not observed radar: storm cells and the hurricane's own center can be in different places than reality, and the newest model run available is usually 1 to 3 hours old.
- **Latest for <your place>** sidebar feed, newest first, refreshes every 2 minutes with a NEW highlight: NWS alerts for the point (new and updated), the local NWS office's Hurricane Local Statement, short-term forecast and special weather statements, the nearest NWS observation (wind, gusts, pressure trend), nearby NWS local storm reports, the latest National Hurricane Center advisory, and local power outage count changes. Defaults to the place you looked up, then your .env home, then the first city in config/landmarks.json.
- **Fix:** the server now reads `.env` from the repo root (it was only reading `server/.env`, so the home location could be ignored).
- `npm run test:live -w server` checks one real past-radar tile and one forecast tile load as PNGs.

## v0.4.0 (2026-10-09, branch `preview`)

### Storm data anchored to the National Hurricane Center, on one UTC timeline
- New ingest: ATCF **b-deck best track** (past positions with 34/50/64-kt wind radii), the **Forecast/Advisory text (TCM)** for official forecast hours, intensity and wind radii, and **a-deck OFCL** to backfill older official forecasts. `/api/timeline`, `/api/advisories/:storm`, `/api/advisory/:storm/:adv`.
- **Immutable per-advisory snapshots** in `data/advisories/` (write once). Full vs intermediate advisories are detected (`12` vs `12A`); an intermediate advisory updates the position and keeps the last full forecast.

### Time slider rewrite
- Slider value is a UTC timestamp over the track's valid times (past capped at 72 h, forecast to the last NHC point). Great-circle position, linear intensity and wind radii between fixes. Replay tests on Hurricane Idalia (2023) archive data check the slider hits every best-track fix within 0.01°.
- **Wind field on the map** at the slider time: tropical-storm, 58 mph and hurricane-force wind areas by quadrant.
- **Time-sliced cone circle** from the NHC 2026 radii table, by forecast hour. No cone in the past.
- **Advisory selector** to compare an older official forecast with the real path. Smooth Play (requestAnimationFrame). ET with a note that the western Panhandle is on Central time.

### Radar, satellite, observations
- Radar now defaults to **NOAA NEXRAD (n0q) via Iowa Environmental Mesonet**. Past slider times beyond the loop show the archived scan for that exact time (up to 7 days). RainViewer is only a backup.
- **GOES-19 infrared satellite** layer, time-matched to the slider.
- **Coastal water levels** (NOAA tide gauges: Apalachicola, Cedar Key, Panama City, Panama City Beach by default) with "vs normal high tide" and "vs predicted tide" (a surge-like estimate), on the map and in a panel.
- **Right now at the nearest weather station** to your location (NWS observation).

### Places, evacuation zones, cameras
- **Threat level follows the place you look up** (its own alerts, distance and warning polygons).
- **"Am I in an evacuation zone?"** for a looked-up place in Florida (FDEM Know Your Zone), with the county's zones drawn on the map.
- **Live cameras** layer: USGS river and coast cameras near the storm or you, click for the latest picture. Windy Webcams only with your own key in `.env`.
- Map: the layer buttons and the "Map shows" time no longer overlap; the map key is collapsible and stays clear of the radar note.

## v0.3.0 (2026-10-09, in progress)

### Part 1: map follows the time slider (hotfix)
- **Root cause fixed:** the map drew the selected storm twice: a big fixed icon at the live position (from the snapshot) and a separate small slider marker. The radar loop also ignored the slider. Now the selected storm has **exactly one icon**, and it is always at the slider time (past track, live, or interpolated forecast). Its label shows the selected time, wind in mph and category. A faint "now" dot marks the live position when you look at another time.
- **Radar follows the slider:** past times show the closest observed radar frame (up to ~2 hours back) with its time; older times say there is no radar; future times hide radar and say "Radar shows observed rain only. Not a forecast."
- **Map keeps the storm in view** while dragging, panning only once it leaves the central 70% (no jitter).
- **mph only** on map labels. Smaller legend so it does not cover the storm.
- **Places layer** (on by default) from new `config/landmarks.json`: Tallahassee, Florida State University, Collegetown (coordinates checked against OpenStreetMap). New `/api/landmarks`.
- `index.html` is served with `Cache-Control: no-cache` so updates show without a hard reload.
- New unit tests (slider marker position, label, radar pick, pan rule, landmarks) and a headless browser check.

### Part 2: look up a place + nearby power outages (branch `preview`)
- **Location search box** (address, city or ZIP). US Census Geocoder first, OpenStreetMap Nominatim fallback (at most 1 request per second, real User-Agent, no autocomplete; one search per click or Enter). Picking a result flies the map there, drops a pin, and makes it the selected place for distance, wind and alerts readouts.
- **Privacy:** the selected place is saved only in your browser (localStorage). It goes only to this app's own local server, which passes it to the geocoder, the National Weather Service and outage feeds. These routes do not write request logs and nothing is saved to disk.
- **Nearby power outages** (within 25 miles of the selected place): points on the map and a list with customers out, cause and estimated fix time (passed times are flagged). Sources come from `config/outage-sources.json`: City of Tallahassee Utilities (live public feed), plus link-outs for Talquin Electric, Duke Energy Florida and FPL, which have no free public feed. County totals come from ORNL ODIN where utilities report. Where no free feed covers a place, the app says so and links utility maps. Polls every 3 minutes, only while a place is selected.
- Map auto-pan now only reacts to slider moves, so it no longer pulls the map back while you look at a searched place.

## v0.2.0 "Tornado night" (2026-10-09)

- **Tornado watches and warnings on the map** (on by default): SPC tornado and severe thunderstorm watch polygons (via Iowa Environmental Mesonet `json/spcwatch.py`, since SPC's `ActiveWW.kml` returns 404) and NWS tornado warning polygons (api.weather.gov, official text verbatim; IEM `sbw.geojson` is a backup). Each shape is labelled in plain English with its expiry in ET; click for issuer, meaning and source.
- **Flash flood warnings and watches** on the map (watch areas built from NWS zone shapes, cached).
- **Slider-aware**: only watches/warnings in effect at the selected time are drawn. Future times say new warnings can be issued at any time.
- **Hazards view** mode: shows only life-safety layers (watches, warnings, cone, path) and hides radar, buoys, rivers and outages.
- **Home banners**: a tornado warning over your location shows a large red "Take shelter now" banner with the official NWS text; a tornado watch or flash flood warning shows a smaller banner. A warning polygon over your home also sets the threat level to RED.
- **Cone wording** everywhere: "The cone shows where the center may go. Dangerous wind, rain, surge and tornadoes often happen outside it."
- New "Tornado and flash flood alerts" panel and `/api/hazards` endpoint. Each layer lists its source, update time (ET) and an OUT OF DATE flag.
- 17 new tests (parsers, slider-time filtering, point-in-polygon banner, copy rules).

## v0.1.0 (2026-10-09)

- First public release: live NHC storm, time slider (past, live, forecast), NWS alerts, hourly winds, radar, rivers, buoys.
