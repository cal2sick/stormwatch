# Changelog

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
