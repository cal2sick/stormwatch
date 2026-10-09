# Changelog

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
