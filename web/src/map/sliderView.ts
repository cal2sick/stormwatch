// What the map should show for the slider time. Pure functions (no DOM), unit tested.

export interface RadarFrame { time: string; path: string }
export type RadarPick =
  | { mode: "live"; index: number; note: null }
  | { mode: "past"; index: number; frameTime: string; note: string }
  | { mode: "past-none"; index: -1; note: string }
  | { mode: "archive"; index: -1; stamp: string; frameTime: string; note: string }
  | { mode: "future"; index: -1; note: string };

export const RADAR_FUTURE_NOTE = "Radar shows observed rain only. Not a forecast.";
const MAX_GAP = 15 * 60_000; // a frame counts as "at" the slider time if within 15 min

/** IEM archive stamp (YYYYMMDDHHMM UTC) for the 5-minute scan at or before t. */
export function iemStampAt(t: number): { stamp: string; time: string } {
  const r = Math.floor(t / 300_000) * 300_000;
  const iso = new Date(r).toISOString();
  return { stamp: iso.replace(/\D/g, "").slice(0, 12), time: iso };
}
export const ARCHIVE_DAYS = 7;

/**
 * Live: animate the loop. Past: the loop frame closest to the slider time, or (with an archive, IEM) the matching
 * archived 5-minute scan. Future: no radar.
 */
export function radarForTime(frames: RadarFrame[], t: number, now: number, live: boolean, archive = false): RadarPick {
  if (live) return { mode: "live", index: frames.length - 1, note: null };
  if (t > now + 60_000) return { mode: "future", index: -1, note: RADAR_FUTURE_NOTE };
  let best = -1, gap = Infinity;
  frames.forEach((f, i) => { const g = Math.abs(Date.parse(f.time) - t); if (g < gap) { gap = g; best = i; } });
  if ((best < 0 || gap > MAX_GAP) && archive && t > now - ARCHIVE_DAYS * 86_400_000) {
    const a = iemStampAt(t);
    return { mode: "archive", index: -1, stamp: a.stamp, frameTime: a.time, note: `Radar image from ${fmt(a.time)} (archived scan matching the selected time).` };
  }
  if (best < 0 || gap > MAX_GAP) {
    const first = frames[0]?.time;
    return { mode: "past-none", index: -1, note: `No radar image for this time. Radar history only goes back to ${first ? fmt(first) : "the last hour or two"}.` };
  }
  return { mode: "past", index: best, frameTime: frames[best].time, note: `Radar image from ${fmt(frames[best].time)} (closest to the selected time).` };
}
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";

/** Pan only when the point (screen px) has left the central `inner` share of the map. No jitter while it stays inside. */
export function needsPan(x: number, y: number, width: number, height: number, inner = 0.7): boolean {
  const mx = (width * (1 - inner)) / 2, my = (height * (1 - inner)) / 2;
  return x < mx || x > width - mx || y < my || y > height - my;
}

/** Label for the one main storm icon: name, selected time, wind in mph, category. */
export function stormLabel(name: string, time: number, windMph: number | null, category: string, live: boolean): string {
  const when = new Date(time).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  return `${name} · ${live ? "Now, " : ""}${when} ET · ${windMph ?? "?"} mph · ${category}`;
}

/** GOES-19 (GOES-East) imagery time for the slider: 10-minute steps, never newer than ~30 min ago (NASA GIBS latency). */
export function goesTimeAt(t: number, now: number): { time: string; clamped: boolean } {
  const latest = now - 30 * 60_000;
  const c = Math.min(t, latest);
  const r = Math.floor(c / 600_000) * 600_000;
  return { time: new Date(r).toISOString().replace(/\.\d{3}Z$/, "Z"), clamped: t > latest };
}

// ---- v0.5 radar view: one rule for live, past scrub and the 0-3 hour forecast radar ----
export const IEM_TILES = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/";
export interface ForecastRadarStep { leadMin: number; fMinute: number; validTime: string; initTime: string }
export interface ForecastRadar { source: string; initTime: string; steps: ForecastRadarStep[] }
export type RadarView =
  | { kind: "observed"; url: string; frameTime: string; latest: boolean; label: string }
  | { kind: "forecast"; url: string; frameTime: string; initTime: string; leadMin: number; label: string }
  | { kind: "none"; reason: "forecast-unavailable" | "beyond-forecast" | "too-old" | "no-radar"; label: string };
export const FORECAST_RADAR_HOURS = 3;
const pad4 = (n: number) => String(Math.round(n)).padStart(4, "0");
const clock = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
const day = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";

/** Observed NEXRAD composite tile template (IEM n0q archive, 5-minute scans). `stamp` = YYYYMMDDHHMM UTC. */
export const iemRadarUrl = (stamp: string) => `${IEM_TILES}ridge::USCOMP-N0Q-${stamp}/{z}/{x}/{y}.png`;
/** HRRR simulated reflectivity tile template for one model run (IEM), forecast minute `fMinute`. */
export const hrrrRadarUrl = (initIso: string, fMinute: number) => `${IEM_TILES}hrrr::REFD-F${pad4(fMinute)}-${iemStampAt(Date.parse(initIso)).stamp}/{z}/{x}/{y}.png`;

/**
 * What radar to show at slider time `t`.
 * - Live (or within a minute of now): the newest scan the server has seen.
 * - Past: the 5-minute scan at or before t (never newer than the newest scan), up to 7 days back.
 * - Future, up to 3 hours: HRRR forecast radar, the model step whose valid time is closest to t. Always labeled forecast.
 * - Beyond 3 hours, or no model data: nothing, with a clear reason (the caller keeps the map readable).
 */
export function radarViewAt(t: number, now: number, live: boolean, latestScan: string | null, fc: ForecastRadar | null): RadarView {
  const latestT = latestScan ? Date.parse(latestScan) : now - 10 * 60_000;
  if (live || Math.abs(t - now) <= 60_000 || (t <= now && t >= latestT)) {
    const s = iemStampAt(Math.min(live ? latestT : t, latestT));
    const ago = Math.max(0, Math.round((now - Date.parse(s.time)) / 60_000));
    return { kind: "observed", url: iemRadarUrl(s.stamp), frameTime: s.time, latest: true, label: `Latest radar scan: ${clock(s.time)} (${ago} min ago)` };
  }
  if (t < now) {
    if (t < now - ARCHIVE_DAYS * 86_400_000) return { kind: "none", reason: "too-old", label: `No radar: the archive used here only goes back ${ARCHIVE_DAYS} days.` };
    const s = iemStampAt(t);
    return { kind: "observed", url: iemRadarUrl(s.stamp), frameTime: s.time, latest: false, label: `Radar at ${day(s.time)} (observed)` };
  }
  if (t > now + FORECAST_RADAR_HOURS * 3.6e6 + 10 * 60_000) return { kind: "none", reason: "beyond-forecast", label: "Forecast radar only covers the next 3 hours. Radar is hidden for this time." };
  if (!fc || !fc.steps.length) return { kind: "none", reason: "forecast-unavailable", label: "Forecast radar is unavailable right now (model data not loaded). Radar is hidden for future times; it never shows old radar as if it were the future." };
  let best = fc.steps[0];
  for (const s of fc.steps) if (Math.abs(Date.parse(s.validTime) - t) < Math.abs(Date.parse(best.validTime) - t)) best = s;
  const lead = Math.round((Date.parse(best.validTime) - now) / 60_000);
  return { kind: "forecast", url: hrrrRadarUrl(best.initTime, best.fMinute), frameTime: best.validTime, initTime: best.initTime, leadMin: lead,
    label: `FORECAST radar for ${clock(best.validTime)} (about ${lead > 0 ? "+" : ""}${lead} min) · HRRR model run ${clock(best.initTime)} · may be wrong` };
}

/** Which of the three big view buttons is active for slider time t. */
export type Phase = "live" | "past" | "forecast";
export const phaseAt = (t: number, now: number, live: boolean): Phase => (live || Math.abs(t - now) <= 60_000 ? "live" : t < now ? "past" : "forecast");
