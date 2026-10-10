# Stormwatch

Free, open-source live hurricane tracker with a time slider. It runs on your own computer at http://localhost:8787 and uses only free public data (National Hurricane Center, National Weather Service, USGS, NOAA buoys, RainViewer radar). No accounts, no API keys, no tracking.

> **Safety first.** Stormwatch is for information only. It can be late, wrong or offline. Official sources always win: the [National Hurricane Center](https://www.nhc.noaa.gov), your local [National Weather Service](https://www.weather.gov) office, and your local emergency management. **If you are told to evacuate, go.** Do not wait on this app.

## Quick start (Mac or Linux)

You need [Node.js 20+](https://nodejs.org) and git.

```bash
git clone https://github.com/cal2sick/stormwatch.git stormwatch && cd stormwatch && npm install && npm start
```

Open **http://localhost:8787** once it says `Server listening`. Stop it with `Ctrl+C`.

**Keep it up to date automatically (recommended):** start it with `npm run start:auto` instead of `npm start`.

```bash
cd stormwatch && npm run start:auto
```

Every 2 minutes it checks GitHub for a new version of your branch. When there is one, it pulls it (`git pull --ff-only`), runs `npm install` only if dependencies changed, rebuilds, and restarts the server. Any open Stormwatch tab shows "Updated to vX, reloading" and reloads itself 3 seconds later. It never overwrites your own edits: if you changed a tracked file (other than npm's `package-lock.json` churn, which it discards) or your branch has its own commits, it logs why and skips the update. Change the interval with `STORMWATCH_UPDATE_SECONDS=300 npm run start:auto`. Stop it with `Ctrl+C`.

Update by hand instead:

```bash
cd stormwatch && git pull && npm install && npm start
```

No Node yet? Mac: `brew install node`. Ubuntu/Debian: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`. Windows: use WSL, or `docker compose up --build`.

## Set your location

There is **no built-in location**. Until you set one, the map shows storms only and centers on the active storm.

**Easiest: "Set your location"** at the top of the left sidebar. Search an address, city or ZIP, or click "Click on the map" and tap your spot. It is saved only in this browser, never shared, overrides `.env`, and "Clear my location" undoes it. Distance, your risk level, winds, alerts, outages and the live feed all follow it.

Optional: set a location for this computer in `.env` (used when the browser has none saved):

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
HOME_LAT=27.95            # decimal degrees, from any map app
HOME_LON=-82.46
HOME_NAME="Home"
USER_AGENT="Stormwatch/0.1 (self-hosted; contact: you@example.com)"   # NWS asks for a contact
```

Restart with `npm start`. `.env` is git-ignored, so your location and contact never get committed. They are only sent to the public weather APIs that need them (NWS alerts/forecast for your point, USGS gauges near you).

## What it does

- **Time slider on one UTC timeline:** opens on live ("Now"). Drag left for where the storm has been (NHC best track, up to 72 h), drag right through the whole NHC forecast. Snaps to 15 minutes and to every forecast hour; Play animates smoothly. The storm on the map moves with the slider, with its path, the tropical-storm / 58 mph / hurricane-force wind areas (NHC wind radii) and a time-sliced cone circle (NHC 2026 radii). Pick an older advisory to compare forecasts. Times are ET; the western Panhandle (west of the Apalachicola River) is on Central time.
- **For the selected time:** storm position, top wind and category, motion, distance from you, wind and gusts at your location (NWS hourly), which official alerts are in effect, and plain-English guidance per 6-hour block.
- **Map layers:** NHC cone, forecast and past track, coastal watches/warnings, tropical-storm wind arrival lines, NEXRAD radar (past slider times show the matching archived scan), GOES-19 infrared satellite, river gauges, buoys, coastal tide gauges with a surge-like readout, live USGS cameras, tornado and flash flood warnings, optional outage plugins.
- **Tap anywhere on the map** for an area card for that exact spot: place name, wind, gusts and rain chance at the selected time (NWS gridpoint forecast), NWS alerts in effect there at that time, distance and direction to the storm, nearest outages. Every value shows its source and time, or says "unavailable". Close with ✕, Esc, or a tap on empty map.
- **Live radar:** checks for the newest NEXRAD scan every minute and says "Latest radar scan: HH:MM ET (X min ago)". "Smooth live radar (estimate)" (on by default, can be turned off) slides the latest scan along the rain motion measured from the last scans until the next real scan arrives.
- **v0.7 look:** the map fills the screen with glass cards over it, a big time dock (Past / Now / Forecast), and an icon layer menu (4 data layers on by default). "When does it hit me?" shows the next 36 hours for home with the worst hours highlighted, "Rain so far" shows observed rain (last hour, 24 h, 72 h, NOAA MRMS), the tap card leads with what the radar shows at that spot, and "Follow the eye" keeps the storm centered while you scrub time.
- **Look up a place:** pin, local alerts, winds, threat level for that place, nearby power outages, and (in Florida) "Am I in an evacuation zone?" with the county's zones on the map.
- **Threat level** (green / yellow / orange / red) from rules in `config/thresholds.json`, with every reason shown.
- Every panel shows its source and the source's own timestamp. Stale data turns amber, then red. Distances and times are labeled estimates. Official alert text is shown verbatim.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Build the web app and serve it plus the API on http://localhost:8787 |
| `npm run start:auto` | Same, plus auto-update: pulls new commits on your branch every 2 min, rebuilds, restarts, and open tabs reload |
| `npm run dev` | Hot reload for development (Vite dev server on :5173 proxies to :8787) |
| `npm test` | Unit tests (geo math, threat rules, parsers, track interpolation, config) |
| `npm run typecheck` | TypeScript checks for server and web |
| `npm run smoke` | Fetch every enabled feed once and print a summary (needs internet) |

Optional Docker: `cp .env.example .env && docker compose up --build`, then http://localhost:8787.

## Sharing it with someone for a day

The server only listens on `localhost`. To give a friend a temporary link while it runs, one free option is a Cloudflare quick tunnel in a second terminal: `npx --yes cloudflared tunnel --url http://localhost:8787`. Anyone with that link can see everything the app shows, including alerts and winds for your location, so only share it with people you trust, and press `Ctrl+C` to end it.

## Configuration

- `.env`: location, `USER_AGENT`, `PORT` / `HOST`, optional plugins. See `.env.example`.
- `config/thresholds.json`: threat rules, stale thresholds and poll intervals (re-read every poll).
- `config/outage-sources.json`: power outage feeds used for "Power outages near ..." after you search for a place (free public feeds only; others are link-outs).
- `config/landmarks.json`: public places drawn on the map for everyone ("Places" layer, on by default). Ships with a few public Tallahassee places. Add your own `{ "name", "lat", "lon", "kind" }` entries. Never put your home here; that stays in `.env`.
- Optional data plugins (power outages, county outage reports) are **off by default**. See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

## Privacy

- No telemetry, analytics, cookies or third-party scripts. The browser talks only to your local server, plus map, radar and satellite tile servers.
- Your location lives only in your `.env` and in the local `data/` cache (both git-ignored).
- See [SECURITY.md](SECURITY.md).

## Docs

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) · [AGENTS.md](AGENTS.md) (for coding agents) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

[MIT](LICENSE). Data belongs to its providers; follow their terms and credit them.

## Data credits

NOAA National Hurricane Center (CurrentStorms.json, ATCF decks, forecast/advisory text, GIS), National Weather Service (api.weather.gov), Storm Prediction Center, NDBC buoys, CO-OPS Tides and Currents, GOES-19 imagery via NASA GIBS, NEXRAD radar via the Iowa Environmental Mesonet (Iowa State University), USGS (water data and HIVIS cameras), Florida Division of Emergency Management (evacuation zones), US Census Geocoder, OpenStreetMap contributors and OpenFreeMap, ORNL ODIN, and RainViewer (radar backup). See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).
