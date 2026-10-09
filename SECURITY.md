# Security and privacy

## Reporting a vulnerability
Please report privately using GitHub's **"Report a vulnerability"** button (Security tab -> Advisories) on this repository. Do not open a public issue for security problems. We will acknowledge within a few days.

## Design
- **Localhost only by default.** The server binds `localhost:8787`. Only change `HOST` if you understand you are exposing it to your network.
- **No secrets and no accounts.** No API keys are used. `.env` (your location, contact) and `data/` (local cache, which includes your location) are git-ignored. Never commit them.
- **No telemetry.** No analytics, tracking pixels, cookies or third-party scripts. The browser talks only to your local server and to public map, radar and satellite tile servers.
- **What leaves your computer:** requests to public weather APIs. NWS and USGS requests include your coordinates (needed to look up your alerts, forecast and gauges) and your `USER_AGENT` string. Tile servers see which map area you view.
- **Sharing links** (for example a tunnel): anyone with the link sees everything the app shows for your location. Share carefully and close the tunnel when done.
- **Do not rely on this app for life-safety decisions.** Follow NHC, NWS and local emergency management.
