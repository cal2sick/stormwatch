# Changelog

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
