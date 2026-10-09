# Data sources

All sources are free and public. No API keys. Respect each provider's terms, poll gently, and credit them.

## Built in

| Data | Source | Needs location | Poll |
|---|---|---|---|
| Active storms, vitals | NHC `https://www.nhc.noaa.gov/CurrentStorms.json` | no | 5 min |
| Cone, track, watches/warnings, past track | NHC GIS shapefiles (per advisory, cached) | no | on new advisory |
| Tropical-storm wind arrival | NHC 34-kt time-of-arrival KMZ | no | on new advisory |
| Public advisory text (verbatim) | NHC advisory product | no | on new advisory |
| Alerts for your point | `https://api.weather.gov/alerts/active?point=LAT,LON` | yes | 60 s |
| Hourly wind, gusts, rain | NWS points -> gridpoint forecast | yes | 15 min |
| Radar | RainViewer public API + tiles | no | 5 min |
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
