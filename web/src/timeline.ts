// Time-based guidance for the selected slider time. Pure functions (no DOM), unit tested.
// Built only from real NWS / NHC feed fields. Guidance only: official NWS alerts always win.
import type { HourlyPoint, NwsAlert } from "./types";
import { gcInterp, type TrackPoint } from "./track";

const H = 3.6e6;

/** Track coordinates ([lon, lat]) from t0 to t1, following the forecast points in between. */
export function pathBetween(track: TrackPoint[], t0: number, t1: number): [number, number][] {
  if (track.length === 0) return [];
  const lo = Math.max(Math.min(t0, t1), track[0].time), hi = Math.min(Math.max(t0, t1), track[track.length - 1].time);
  if (hi < lo) return [];
  const at = (t: number): [number, number] => {
    if (t <= track[0].time) return [track[0].lon, track[0].lat];
    let i = 0; while (i < track.length - 2 && track[i + 1].time < t) i++;
    const a = track[i], b = track[i + 1];
    const [lat, lon] = gcInterp(a.lat, a.lon, b.lat, b.lon, Math.min(1, (t - a.time) / (b.time - a.time)));
    return [lon, lat];
  };
  const out: [number, number][] = [at(lo)];
  for (const p of track) if (p.time > lo && p.time < hi) out.push([p.lon, p.lat]);
  out.push(at(hi));
  return out;
}

/**
 * NHC 2026 cone: radius of the 2/3-probability circle (nautical miles) by forecast hour (tau, hours from the
 * advisory's synoptic time). Source: https://www.nhc.noaa.gov/aboutcone.shtml (2026 season table).
 */
export const CONE_NM_2026: Record<"atlantic" | "pacific", [number, number][]> = {
  atlantic: [[0, 0], [12, 25], [24, 39], [36, 49], [48, 62], [60, 77], [72, 95], [96, 134], [120, 200]],
  pacific: [[0, 0], [12, 25], [24, 37], [36, 48], [48, 56], [60, 66], [72, 78], [96, 106], [120, 138]],
};
export const basinOf = (stormId: string | null | undefined): "atlantic" | "pacific" => (/^(ep|cp)/i.test(stormId ?? "") ? "pacific" : "atlantic");
/** Cone circle radius in nautical miles at tau (linear between table rows; beyond 120 h holds the 120-h value). */
export function coneRadiusNm(tau: number, basin: "atlantic" | "pacific" = "atlantic"): number {
  const T = CONE_NM_2026[basin], h = Math.max(0, tau);
  for (let i = 1; i < T.length; i++) {
    const [h0, r0] = T[i - 1], [h1, r1] = T[i];
    if (h <= h1) return r0 + ((h - h0) / (h1 - h0)) * (r1 - r0);
  }
  return T[T.length - 1][1];
}
/** Same, in statute miles (what the map ring draws). */
export const coneRadiusMi = (tau: number, basin: "atlantic" | "pacific" = "atlantic") => coneRadiusNm(tau, basin) * 1.15078;

export function circle(lon: number, lat: number, radiusMi: number, n = 64): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusMi / 69.0, dLon = radiusMi / (69.0 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return out;
}

/** The NWS hourly forecast hour that contains time t (or null if outside the forecast). */
export function hourAt(hourly: HourlyPoint[], t: number): HourlyPoint | null {
  for (const h of hourly) { const s = Date.parse(h.time); if (t >= s && t < s + H) return h; }
  return null;
}

/** NWS alerts in effect at time t: started (onset or sent) and not yet ended (ends, else expires). */
export function alertsActiveAt(alerts: NwsAlert[], t: number): NwsAlert[] {
  return alerts.filter((a) => {
    const start = Date.parse(a.onset ?? a.sent ?? "") || -Infinity;
    const endStr = a.ends ?? a.expires; const end = endStr ? Date.parse(endStr) : Infinity;
    return t >= start && t < end;
  });
}

export interface WindowAdvice { start: number; end: number; maxWindMph: number | null; maxGustMph: number | null; maxRainChance: number | null; level: "low" | "breezy" | "strong" | "damaging" | "destructive"; text: string }

/** Plain-language advice for one block of forecast hours. */
export function adviceFor(hours: HourlyPoint[]): WindowAdvice | null {
  if (!hours.length) return null;
  const max = (k: "windMph" | "gustMph" | "pop") => { const v = hours.map((h) => h[k]).filter((x): x is number => x != null); return v.length ? Math.max(...v) : null; };
  const w = max("windMph"), g = max("gustMph"), pop = max("pop");
  const top = Math.max(g ?? 0, w ?? 0);
  let level: WindowAdvice["level"], act: string;
  if (top >= 74 || (w ?? 0) >= 58) { level = "destructive"; act = "Hurricane-force winds possible. Stay in an interior room away from windows."; }
  else if (top >= 58) { level = "damaging"; act = "Damaging gusts possible: falling trees and power outages likely. Stay indoors, away from windows."; }
  else if (top >= 40) { level = "strong"; act = "Strong gusts. Stay indoors if you can, secure loose outdoor items, expect some power outages."; }
  else if (top >= 25) { level = "breezy"; act = "Windy. Use care driving and outdoors."; }
  else { level = "low"; act = "Lighter winds."; }
  const rain = pop != null && pop >= 60 ? ` Rain likely (up to ${pop}% chance).` : pop != null && pop >= 30 ? ` Some rain possible (up to ${pop}% chance).` : "";
  const parts = [g != null ? `strongest gusts about ${g} mph` : null, w != null ? `steady wind up to ${w} mph` : null].filter(Boolean).join(", ");
  return { start: Date.parse(hours[0].time), end: Date.parse(hours[hours.length - 1].time) + H, maxWindMph: w, maxGustMph: g, maxRainChance: pop, level,
    text: `${parts ? parts[0].toUpperCase() + parts.slice(1) + ". " : ""}${act}${rain}` };
}

/** Split the hourly forecast into 6-hour blocks aligned to ET midnight/6am/noon/6pm. */
export function adviceWindows(hourly: HourlyPoint[], from: number, to: number): WindowAdvice[] {
  const etHour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(t)));
  const groups: HourlyPoint[][] = [];
  let cur: HourlyPoint[] = [], key = "";
  for (const h of hourly) {
    const t = Date.parse(h.time); if (t + H <= from || t >= to) continue;
    const k = new Date(t - (etHour(t) % 6) * H).toISOString().slice(0, 13);
    if (k !== key && cur.length) { groups.push(cur); cur = []; }
    key = k; cur.push(h);
  }
  if (cur.length) groups.push(cur);
  return groups.map(adviceFor).filter((x): x is WindowAdvice => x != null);
}

/** Slider magnets: NHC past-track / forecast times and "now". */
export function magnets(track: TrackPoint[], now: number): number[] {
  return [...new Set([now, ...track.map((p) => p.time)])].sort((a, b) => a - b);
}
/** Snap a raw slider time to 15-minute steps, but stick to a nearby magnet (within `pullMs`). */
export function snapTime(raw: number, mags: number[], stepMs = 15 * 60_000, pullMs = 40 * 60_000): number {
  let best: number | null = null;
  for (const m of mags) if (Math.abs(m - raw) <= pullMs && (best == null || Math.abs(m - raw) < Math.abs(best - raw))) best = m;
  return best ?? Math.round(raw / stepMs) * stepMs;
}

export interface LiveStorm { lat: number; lon: number; lastUpdate: string | null; intensityKt: number | null; advisoryNumber?: string | null }
/**
 * One track for the whole slider: NHC past positions (best track) before the advisory, the latest
 * observed NHC position, then NHC forecast points. Both the map marker and the readout use stateAt() on this.
 */
export function fullTrack(past: TrackPoint[], forecast: TrackPoint[], live: LiveStorm | null): TrackPoint[] {
  const f0 = forecast[0]?.time ?? Infinity;
  const pts = [...past.filter((p) => p.time < f0), ...forecast];
  if (live?.lastUpdate) {
    const t = Date.parse(live.lastUpdate);
    if (isFinite(t)) {
      const i = pts.findIndex((p) => p.time === t);
      const obs: TrackPoint = { time: t, lat: live.lat, lon: live.lon, windKt: live.intensityKt, tau: null, source: `latest NHC position (advisory ${live.advisoryNumber ?? "?"})` };
      if (i >= 0) pts[i] = { ...obs, tau: pts[i].tau };
      else pts.push(obs);
    }
  }
  return pts.filter((p) => isFinite(p.time) && isFinite(p.lat) && isFinite(p.lon)).sort((a, b) => a.time - b.time);
}
