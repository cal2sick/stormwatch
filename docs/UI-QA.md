# UI QA pass (v0.7.1)

Goal: anyone can understand the map at a glance, and nothing overlaps, cuts off or hides under something else.
Checked with a headless browser at 1440x900, 1280x800 and 1024x768 in these states: live, past, forecast, no location set,
first visit (help card), alert bar expanded, live feed, tap card, map key, "More panels", low-data mode, sidebar folded.
The script flags cut-off text, overlapping cards, things off screen and leftover jargon.

## Privacy
- There is no built-in location any more. Nothing in the app, README or docs names a default place. With no location the
  map shows storms only and centers on the active storm; the left column says "No location set" with a "Set your location"
  button. Public places (Tallahassee landmarks) stay on the Places layer as plain landmarks.

## Top of the screen
- Was: a safety banner, a setup banner and several alert banners stacked, pushing the map down.
  Now: at most one compact alert bar (most urgent alert, "+N more" opens a list that floats over the map). It has an ✕.
  Dismissed alerts are remembered per alert (id + type) in this browser; a new or upgraded alert shows again.
  A tornado warning still gets the big red banner; its ✕ shrinks it into the alert bar (it never disappears while in effect).
- The "For information only" line moved to the bottom status bar and to the Help card.
- The update toast has an ✕.
- Top bar: brand no longer overlaps the storm pills; Read aloud / Notifications / Low-data mode moved into one "Options" menu.

## Words
- Agency abbreviations (NHC, NWS, SPC, MRMS, USGS, HRRR, NDBC, EIA, ODIN) are spelled out in labels and sources.
- "Threat RED" is now "Your risk: High" (Low / Moderate / Elevated / High) with a tooltip that says what it means and why.
- Radar: "dBZ" moved to "More details"; the headline says "Heavy rain" etc. The forecast radar says it is a computer
  model's guess, not real radar. Smooth radar says "Real scan at 8:10 PM ET, moved forward 6 min by estimate".
- Popups: "Power outage / Out since / Estimated restore", "River level ... in the last 3 hours", "NOAA buoy ... millibars".
- A "What this means for you" card at the top of the left column: live/past/forecast, the time, your risk, distance to
  the storm, alerts, windiest hours and what to do.
- First visit: a "What am I looking at?" card (storm icon, time slider, colors, alerts). The ? button reopens it.

## Map
- Map key moved into the layer menu ("Map key" button) and opens in the same top-right slot as the tap card; only one is
  open at a time. Its sections are in plain words (radar colors, storm colors, path, likely area, wind areas, watches vs
  warnings, outages, rain, rivers/tides/buoys, cameras, evacuation zones).
- Watch/warning labels: one label per shape, placed inside it, most urgent first, padded so they never touch; invisible
  stand-ins for the storm icon + label and the home pin keep other labels off them.
- Forecast point labels: larger, with a halo, and they move to another side instead of overlapping.
- One color per alert type everywhere (map shapes, alert bar, hour strip dots, tap card, map key).
- Map attribution has its own thin strip at the bottom; the time dock and zoom buttons sit above it.
- Past / forecast quick jumps ("1 h ago", "+30 min") are a separate row under Live / Past / Forecast.
- On narrow screens the radar box hides while the tap card or map key is open, and the time dock drops its end labels.

## Live feed ("Latest for ...")
- Checks every 60 seconds. Newest first, each with the exact ET time and "X min ago", and a NEW tag for 15 minutes.
- Filter chips: All, Storm, Alerts, Reports, Power, Weather (with counts).
- Storm: each new advisory or intermediate position with position, winds, pressure, movement and what changed since the
  previous one (remembered in this browser).
- Weather Service statements: a 1-2 line plain summary (labeled "Summary") and "Read the full official text" (verbatim).
- Alerts: new, "Updated:" and "Ended:" (when an alert drops off the list).
- Storm reports read like "Tree down, 2 mi north-northwest of Town, FL (5 miles away)".
- Airport weather: wind, gusts, pressure falling/rising over 1 and 3 hours, and the peak gust in the last 12 hours.
- Power: customers out and % for the live utility feed that covers the place, with the change since the previous check.
- Rivers: gauges rising 0.3 ft or more in 3 hours.

## Other fixes
- Source lines wrap instead of being cut off; panel titles wrap.
- Tap card tiles never cut their labels; it sits below the Live / Past / Forecast control.
- "More panels" on screens under 1300 px wide replaces the left column instead of squeezing the map.
- Faint text color raised to pass contrast (4.5:1); thin dark scrollbars; visible keyboard focus on every button.
