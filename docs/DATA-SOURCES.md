# Data sources

All sources are free and public. No API keys (one optional camera source takes your own key, off by default). Respect each provider's terms, poll gently, and credit them.

## Built in

| Data | Source | Needs location | Poll |
|---|---|---|---|
| Active storms, vitals | NHC `https://www.nhc.noaa.gov/CurrentStorms.json` | no | 5 min |
| Cone, track, watches/warnings, past track | NHC GIS shapefiles (per advisory, cached) | no | on new advisory |
| Tropical-storm wind arrival | NHC 34-kt time-of-arrival KMZ | no | on new advisory |
| Public advisory text (verbatim) | NHC advisory product | no | on new advisory |
| Alerts for your point | `https://api.weather.gov/alerts/active?point=LAT,LON` | yes | 60 s |
| Hourly wind, gusts, rain | NWS points -> gridpoint forecast | yes | 15 min |
| Storm timeline: past positions | NHC ATCF b-deck best track `https://ftp.nhc.noaa.gov/atcf/btk/b<id>.dat` (BEST, with 34/50/64-kt radii) | no | 5 min |
| Storm timeline: official forecast | NHC Forecast/Advisory text (TCM, `forecastAdvisory.url` in CurrentStorms.json): taus, intensity, wind radii | no | 5 min |
| Older official forecasts (advisory selector) | NHC ATCF a-deck OFCL `https://ftp.nhc.noaa.gov/atcf/aid_public/a<id>.dat.gz` | no | 60 min |
| Radar (default) | NOAA NEXRAD base reflectivity composite (n0q) via Iowa Environmental Mesonet: scan list `json/radar.py`, tiles `cache/tile.py/1.0.0/ridge::USCOMP-N0Q-<YYYYMMDDHHMM>`; archived 5-min scans match past slider times (7 days) | no | 5 min |
| Radar (backup only) | RainViewer public API + tiles, used only if IEM is down | no | 5 min |
| Satellite (optional layer) | GOES-19 (GOES-East) ABI band 13 clean infrared via NASA GIBS WMTS, time-matched to the slider (about 30 min latency) | no | tiles |
| Coastal water levels | NOAA CO-OPS Tides and Currents API, water level and predicted tide on MHHW (stations in `config/thresholds.json` `coopsStations`) | no | 6 min |
| Latest local weather reading | Nearest NWS observation station to your location (api.weather.gov points -> observationStations -> latest) | yes | 10 min |
| Live cameras | USGS HIVIS / NIMS camera list `https://api.waterdata.usgs.gov/nims/cameras`, newest still image, within 250 miles of the storm or you | no | 15 min |
| River gauges | USGS NWIS instantaneous values, box around your location (`USGS_BOX_DEG`) | yes | 15 min |
| Buoys near the storm | NOAA NDBC realtime2 | no | 10 min |
| Basemap | OpenFreeMap (OpenStreetMap data) | no | tiles |
| Night lights (optional layer) | NASA GIBS VIIRS | no | tiles |

NWS asks every client to send a `User-Agent` with contact info. Set `USER_AGENT` in `.env`.

## Optional plugins (off by default)

### Live outage points from a utility's public ArcGIS layer
Many utilities publish their public outage map from an ArcGIS MapServer/FeatureServer. If yours does, and its terms allow it, set:

```bash
OUTAGE_ARCGIS_URL="https://<host>/arcgis/rest/services/<Service>/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json"
OUTAGE_ARCGIS_NAME="My utility outages"
OUTAGE_MAP_URL="https://<your utility's public outage map>"
```

The plugin reads point features and the attributes `customers`, `status`, `cause`, `off`, `etr`, `outagetype` when present. Poll interval: `pollSeconds.power` (default 3 min). Rules: only use layers that load without a login, key or CAPTCHA; never pull keys out of a web app; credit the utility; poll no faster than every 2 to 5 minutes.

### County-level outage reports (ORNL ODIN)
```bash
ODIN_FIPS=12086   # 5-digit county FIPS code (example: Miami-Dade, FL)
```
Uses `https://odin.ornl.gov/odi?format=JSON`, filtered to that county. Coverage depends on which utilities report to ODIN.

### Always available
Link-outs only: your utility's own outage map (`OUTAGE_MAP_URL`) and PowerOutage.us.

## Ideas for more sources (contributions welcome)
NHC wind speed probabilities, storm surge (P-Surge), WPC rainfall, model tracks (ATCF a-decks), GOES satellite imagery, reconnaissance (hurricane hunter) data. Keep them free, keyless and opt-in if they are heavy.


## Severe-weather hazards (v0.2)

| Layer | Source | URL | Poll | Notes |
|---|---|---|---|---|
| Tornado / severe thunderstorm watches | NOAA SPC via Iowa Environmental Mesonet | `https://mesonet.agron.iastate.edu/json/spcwatch.py` | 60 s | SPC `ActiveWW.kml` returns 404; NWS watch alerts have no polygon |
| Tornado warnings, flash flood warnings and watches | NWS alerts API | `https://api.weather.gov/alerts/active?event=Tornado Warning,Flash Flood Warning,Flash Flood Watch` | 60 s | Text kept verbatim; watch areas use `api.weather.gov/zones/...` shapes (cached, max 60 new zones per poll) |
| Backup warning polygons | Iowa Environmental Mesonet storm-based warnings | `https://mesonet.agron.iastate.edu/geojson/sbw.geojson` | only if NWS fails | No full text; labelled as backup |

## Location search and nearby outages (v0.3.0)
- **US Census Geocoder** `geocoding.geo.census.gov/geocoder/locations/onelineaddress` (street addresses, US, free, no key) and `geographies/coordinates` (county FIPS for ODIN).
- **OpenStreetMap Nominatim** `nominatim.openstreetmap.org/search` (cities, ZIPs, places). Usage policy: max 1 request/second, identifying User-Agent (set `USER_AGENT` in `.env`), no autocomplete. Stormwatch enforces all three.
- **NWS** `api.weather.gov/points` + hourly forecast + `alerts/active?point=` for the selected place.
- **Outage registry** `config/outage-sources.json`: `arcgis` entries are public ArcGIS outage-point queries (no key) with a bbox; `link` entries are utilities with no free machine feed (link-out only). Never add feeds that need a login, a key copied out of a web page, or a CAPTCHA.
- **ORNL ODIN** `odin.ornl.gov/odi?format=JSON`: county-level outage counts for utilities that report (cached 10 min).

## Storm timeline, radar, observations, evacuation zones, cameras (v0.4.0)

- **One UTC timeline.** Every storm position is normalized to `{ validUTC, tau, lat, lon, vmaxKt, mslp, r34, r50, r64, src }` where `src` is `BEST` (ATCF best track), `OFCL` (official forecast) or `LIVE` (CurrentStorms.json). The slider value is a UTC timestamp; positions are great-circle interpolated by valid time (never array index, never issue time); intensity and wind radii are linear.
- **Immutable advisory snapshots.** Each advisory is written once to `data/advisories/<storm>/<adv>.json` (gitignored) and never overwritten. Full advisories (e.g. `12`) carry the forecast; intermediate advisories (e.g. `12A`) carry an updated position only and point to the full advisory whose forecast still applies (`forecastFrom`). a-deck OFCL forecasts backfill advisories issued before the app started (`OFCL <YYYYMMDDHH>`).
- **Cone circle.** The ring around the storm at the slider time is the NHC 2026 2/3-probability circle for that forecast hour (Atlantic: 12 h 25 nm, 24 h 39, 36 h 49, 48 h 62, 60 h 77, 72 h 95, 96 h 134, 120 h 200; Eastern/Central Pacific has its own table), linearly interpolated by tau. Source: https://www.nhc.noaa.gov/aboutcone.shtml. The official NHC cone polygon is still drawn as published.
- **Evacuation zones (Florida).** FDEM "Know Your Zone" statewide feature service `https://services1.arcgis.com/CY1LXxl9zlJeBuRZ/ArcGIS/rest/services/Evacuation_Zones/FeatureServer/0`, queried only for the place you look up (route `/api/evac`, no request logs, nothing stored). The county's zones are drawn on the map. A zone is a planning area; counties issue the evacuation orders.
- **Cameras.** USGS HIVIS is on by default (public, keyless). Windy Webcams is optional: put your own free key in `.env` as `WINDY_API_KEY`; never commit it. FAA WeatherCams and state 511 traffic cameras are linked only (no keyless public API or they need an agreement).
- **Credits.** NOAA (NHC, NWS, NDBC, CO-OPS, GOES-19), NASA GIBS, Iowa Environmental Mesonet (Iowa State University), USGS, Florida Division of Emergency Management, OpenStreetMap contributors / OpenFreeMap, RainViewer (backup). Each layer shows its own source line on the map.

## Forecast radar and local updates feed (v0.5.0)
- **Forecast radar (0-3 h):** NOAA HRRR simulated composite reflectivity, tiles from Iowa Environmental Mesonet: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F{minute}-{runYYYYMMDDHHMM}/{z}/{x}/{y}.png`, run/valid metadata at `https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_{minute}.json`. Free, keyless; polled every 10 min (`hrrr` in thresholds). Model output, always labeled forecast. 15-minute steps up to 5 h after the run, hourly after.
- **Past radar:** the IEM n0q composite archive, one tile set per 5-minute scan: `ridge::USCOMP-N0Q-{YYYYMMDDHHMM}`.
- **Latest for <place>:** `api.weather.gov` alerts for the point, `/products/types/{HLS,NOW,SPS}/locations/{office}` and the product text (headline quoted verbatim), the nearest observation station's last observations, and NWS local storm reports via `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?wfos={office}&hours=12`. Route `/api/localfeed` runs with request logging off and a 2-minute in-memory cache; nothing is written to disk.
