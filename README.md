# Stormwatch

Free, open-source live hurricane tracker with a time slider. It runs on your own computer at http://localhost:8787 and uses only free public data (National Hurricane Center, National Weather Service, USGS, NOAA buoys, RainViewer radar). No accounts, no API keys, no tracking.

> **Safety first.** Stormwatch is for information only. It can be late, wrong or offline. Official sources always win: the [National Hurricane Center](https://www.nhc.noaa.gov), your local [National Weather Service](https://www.weather.gov) office, and your local emergency management. **If you are told to evacuate, go.** Do not wait on this app.

## Quick start (Mac or Linux)

You need [Node.js 20+](https://nodejs.org) and git.

```bash
git clone https://github.com/cal2sick/stormwatch.git stormwatch && cd stormwatch && npm install && npm start
```

Open **http://localhost:8787** once it says `Server listening`. Stop it with `Ctrl+C`.

Update later:

```bash
cd stormwatch && git pull && npm install && npm start
```

No Node yet? Mac: `brew install node`. Ubuntu/Debian: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`. Windows: use WSL, or `docker compose up --build`.

## Set your location (recommended)

Without a location, Stormwatch shows the storms, cone and time slider, and asks you to set one. With a location, you also get distance to the storm, NWS alerts and hourly winds for your spot, nearby river gauges, and a threat level.

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

- **Time slider:** opens on live ("Now"). Drag left to see where the storm has been (NHC past track, up to 48 h), drag right to see where the NHC forecast puts it, through tomorrow night. Snaps to 15 minutes and to every NHC forecast hour. The storm on the map moves with the slider, with its path, a typical-error ring and the selected time shown in large text.
- **For the selected time:** storm position, top wind and category, motion, distance from you, wind and gusts at your location (NWS hourly), which official alerts are in effect, and plain-English guidance per 6-hour block.
- **Map layers:** NHC cone, forecast and past track, coastal watches/warnings, tropical-storm wind arrival lines, radar loop, river gauges, buoys, optional outage plugins.
- **Threat level** (green / yellow / orange / red) from rules in `config/thresholds.json`, with every reason shown.
- Every panel shows its source and the source's own timestamp. Stale data turns amber, then red. Distances and times are labeled estimates. Official alert text is shown verbatim.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Build the web app and serve it plus the API on http://localhost:8787 |
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
- `config/landmarks.json`: public places drawn on the map for everyone ("Places" layer, on by default). Ships with Tallahassee, Florida State University and Collegetown. Add your own `{ "name", "lat", "lon", "kind" }` entries. Never put your home here; that stays in `.env`.
- Optional data plugins (power outages, county outage reports) are **off by default**. See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

## Privacy

- No telemetry, analytics, cookies or third-party scripts. The browser talks only to your local server, plus map, radar and satellite tile servers.
- Your location lives only in your `.env` and in the local `data/` cache (both git-ignored).
- See [SECURITY.md](SECURITY.md).

## Docs

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) · [AGENTS.md](AGENTS.md) (for coding agents) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

[MIT](LICENSE). Data belongs to its providers (NOAA/NHC/NWS, USGS, NDBC, RainViewer, OpenStreetMap contributors and others); follow their terms and credit them.
