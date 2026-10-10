// Forecast-track time machine: where will the storm be at time t?
// Pure functions (no DOM) so they can be unit tested. Linear interpolation in time between NHC
// forecast points; position along the great circle, intensity linear. Display only — NHC/NWS win.
const R = 3958.7613;
const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;

export interface TrackPoint { time: number; lat: number; lon: number; windKt: number | null; mslp?: number | null; tau?: number | null; type?: string | null; source: string }
export interface TrackState {
  time: number; lat: number; lon: number; windKt: number | null; windMph: number | null; category: string;
  headingDeg: number | null; headingCardinal: string; speedMph: number | null;
  distanceMi: number; bearingFromHomeDeg: number; bearingFromHomeCardinal: string;
  exact: TrackPoint | null; before: TrackPoint | null; after: TrackPoint | null; frac: number;
  outOfRange: "before" | "after" | null;
}

export function distanceMi(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const CARD = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const cardinal = (d: number) => CARD[Math.round(d / 22.5) % 16];

/** Great-circle intermediate point, f in [0,1]. */
export function gcInterp(lat1: number, lon1: number, lat2: number, lon2: number, f: number): [number, number] {
  const p1 = rad(lat1), l1 = rad(lon1), p2 = rad(lat2), l2 = rad(lon2);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-12) return [lat1, lon1];
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))];
}

export const ktToMph = (kt: number) => kt * 1.150779;
/** NHC rounds advisory mph to the nearest 5. */
export const roundMph5 = (mph: number) => Math.round(mph / 5) * 5;
export function categoryFromKt(kt: number | null): string {
  if (kt == null) return "—";
  if (kt >= 137) return "Cat 5"; if (kt >= 113) return "Cat 4"; if (kt >= 96) return "Cat 3";
  if (kt >= 83) return "Cat 2"; if (kt >= 64) return "Cat 1"; if (kt >= 34) return "Tropical Storm";
  return "Depression";
}

/** Sort, drop duplicates/invalid. */
export function cleanTrack(pts: TrackPoint[]): TrackPoint[] {
  const s = pts.filter((p) => isFinite(p.time) && isFinite(p.lat) && isFinite(p.lon)).sort((a, b) => a.time - b.time);
  return s.filter((p, i) => i === 0 || p.time !== s[i - 1].time);
}

function posAt(track: TrackPoint[], t: number): [number, number] {
  if (t <= track[0].time) return [track[0].lat, track[0].lon];
  const last = track[track.length - 1]; if (t >= last.time) return [last.lat, last.lon];
  let i = 0; while (track[i + 1].time < t) i++;
  const a = track[i], b = track[i + 1];
  return gcInterp(a.lat, a.lon, b.lat, b.lon, (t - a.time) / (b.time - a.time));
}

export function stateAt(track: TrackPoint[], t: number, home: { lat: number; lon: number }): TrackState | null {
  if (track.length === 0) return null;
  let before: TrackPoint, after: TrackPoint, frac: number, outOfRange: TrackState["outOfRange"] = null;
  if (t <= track[0].time) { before = after = track[0]; frac = 0; if (t < track[0].time) outOfRange = "before"; }
  else if (t >= track[track.length - 1].time) { before = after = track[track.length - 1]; frac = 0; if (t > track[track.length - 1].time) outOfRange = "after"; }
  else {
    let i = 0; while (track[i + 1].time < t) i++;
    before = track[i]; after = track[i + 1]; frac = (t - before.time) / (after.time - before.time);
  }
  const [lat, lon] = before === after ? [before.lat, before.lon] : gcInterp(before.lat, before.lon, after.lat, after.lon, frac);
  const windKt = before.windKt == null || after.windKt == null ? (before.windKt ?? after.windKt) : before.windKt + (after.windKt - before.windKt) * frac;
  // Motion: displacement over ±1 h around t (clamped to the track), skipping zero-length stretches.
  let headingDeg: number | null = null, speedMph: number | null = null;
  if (track.length > 1) {
    const lo = track[0].time, hi = track[track.length - 1].time;
    for (const w of [1, 3, 6, 12]) {
      const ta = Math.max(lo, t - w * 3.6e6), tb = Math.min(hi, t + w * 3.6e6);
      if (tb <= ta) break;
      const pa = posAt(track, ta), pb = posAt(track, tb);
      const dist = distanceMi(pa[0], pa[1], pb[0], pb[1]);
      if (dist > 0.5) { headingDeg = bearingDeg(pa[0], pa[1], pb[0], pb[1]); speedMph = dist / ((tb - ta) / 3.6e6); break; }
    }
  }
  const bh = bearingDeg(home.lat, home.lon, lat, lon);
  const exact = frac === 0 && !outOfRange ? before : frac === 1 ? after : null;
  return {
    time: t, lat, lon, windKt, windMph: windKt == null ? null : roundMph5(ktToMph(windKt)), category: categoryFromKt(windKt == null ? null : Math.round(windKt)),
    headingDeg, headingCardinal: headingDeg == null ? "—" : cardinal(headingDeg), speedMph,
    distanceMi: distanceMi(home.lat, home.lon, lat, lon), bearingFromHomeDeg: bh, bearingFromHomeCardinal: cardinal(bh),
    exact, before, after, frac, outOfRange,
  };
}

/** Closest point of approach to home along the interpolated track (sampled every stepMin). */
export function closestApproach(track: TrackPoint[], home: { lat: number; lon: number }, fromT?: number, stepMin = 5) {
  if (!track.length) return null;
  const t0 = Math.max(fromT ?? track[0].time, track[0].time), t1 = track[track.length - 1].time;
  let best: TrackState | null = null;
  for (let t = t0; t <= t1; t += stepMin * 60_000) { const s = stateAt(track, t, home)!; if (!best || s.distanceMi < best.distanceMi) best = s; }
  return best;
}

const fmtTime = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
export const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "N" : "S"}`;
export const fmtLon = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "E" : "W"}`;
const tauLabel = (p: TrackPoint) => (p.tau == null ? p.source : `${p.tau}h forecast point`);

/** One-line plain-English readout. */
export function describe(s: TrackState, stormName: string, advisory: string | null, homeName = "home"): string {
  const wind = s.windMph == null ? "intensity n/a" : `${s.windMph} mph (${s.category})`;
  const motion = s.headingDeg == null ? "" : `, moving ${s.headingCardinal} ~${Math.round(s.speedMph ?? 0)} mph`;
  let src: string;
  if (s.outOfRange === "before") src = `before the first forecast point (${fmtTime(s.before!.time)})`;
  else if (s.outOfRange === "after") src = `beyond the last forecast point (${fmtTime(s.after!.time)}) — no forecast`;
  else if (s.exact) src = `exact ${tauLabel(s.exact)}`;
  else src = `estimated ${Math.round(s.frac * 100)}% of the way between ${tauLabel(s.before!)} and ${tauLabel(s.after!)}`;
  return `${fmtTime(s.time)}: ${stormName} center ~${fmtLat(s.lat)} ${fmtLon(s.lon)}, ~${Math.round(s.distanceMi)} mi ${s.bearingFromHomeCardinal} of ${homeName}, ${wind}${motion}. Source: National Hurricane Center advisory ${advisory ?? "?"}, ${src}.`;
}
export { fmtTime };
