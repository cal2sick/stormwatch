// Unified UTC storm timeline for the slider. Pure functions (no DOM), unit tested.
// Rules: the slider value is a UTC timestamp; positions are great-circle interpolated between fixes by VALID time
// (never array index, never issue time); intensity and wind radii are linear in time.
import type { AdvisoryRecord, Quad, StormTimeline, TrackFix } from "./types";
import { cleanTrack, gcInterp, type TrackPoint } from "./track";
import { basinOf, coneRadiusMi } from "./timeline";

export type TrackPointR = TrackPoint & { r34?: Quad | null; r50?: Quad | null; r64?: Quad | null };

const toPoint = (f: TrackFix, source: string): TrackPointR => ({
  time: Date.parse(f.validUTC), lat: f.lat, lon: f.lon, windKt: f.vmaxKt, mslp: f.mslp, tau: f.tau, type: f.stormType,
  source, r34: f.r34, r50: f.r50, r64: f.r64,
});

/**
 * One track: NHC best track before the advisory's first point, the latest live position (only with the latest advisory),
 * then the advisory's official forecast points. Exact fixes are kept untouched so interpolation hits them exactly.
 */
export function timelineTrack(tl: StormTimeline, adv: AdvisoryRecord | null, isLatest: boolean): TrackPointR[] {
  const fc = (adv?.kind === "full" ? adv.points : []).map((f) => toPoint(f, `NHC advisory ${adv!.advNum} forecast`));
  const best = tl.best.map((f) => toPoint(f, "NHC best track"));
  const lv = isLatest && tl.live ? { ...toPoint(tl.live, "latest NHC position"), tau: null } : null;
  // Past/forecast boundary: the live position for the latest advisory, else the advisory's first forecast point.
  const cut = lv ? Math.max(lv.time, fc[0]?.time ?? -Infinity) : fc[0]?.time ?? Infinity;
  const L = lv?.time ?? cut;
  const past = best.filter((p) => p.time <= L && (lv ? true : p.time < cut));
  const fut = lv ? fc.filter((p) => p.time > L) : fc;
  const pts = [...past, ...(lv && !past.some((p) => p.time === lv.time) ? [lv] : []), ...fut];
  return cleanTrack(pts) as TrackPointR[];
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
function lerpQuad(a: Quad | null | undefined, b: Quad | null | undefined, f: number): Quad | null {
  if (!a && !b) return null;
  const A = a ?? [0, 0, 0, 0], B = b ?? [0, 0, 0, 0];
  const q = A.map((x, i) => lerp(x, B[i], f)) as Quad;
  return q.some((x) => x > 0.5) ? q : null;
}
export interface RadiiState { r34: Quad | null; r50: Quad | null; r64: Quad | null }
/** Wind radii at time t, linear between the two fixes around t. Outside the track: none. */
export function radiiAt(track: TrackPointR[], t: number): RadiiState {
  const none = { r34: null, r50: null, r64: null };
  if (!track.length || t < track[0].time || t > track[track.length - 1].time) return none;
  let i = 0; while (i < track.length - 1 && track[i + 1].time < t) i++;
  const a = track[i], b = track[Math.min(i + 1, track.length - 1)];
  const f = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
  return { r34: lerpQuad(a.r34, b.r34, f), r50: lerpQuad(a.r50, b.r50, f), r64: lerpQuad(a.r64, b.r64, f) };
}

/** Polygon ring of a 4-quadrant wind field (nautical-mile radii NE, SE, SW, NW) around a center. */
export function quadRing(lon: number, lat: number, q: Quad, stepsPerQuad = 12): [number, number][] {
  const out: [number, number][] = [];
  const kmPerDegLat = 111.2, nmKm = 1.852;
  // NE quadrant spans bearings 0..90, SE 90..180, SW 180..270, NW 270..360.
  for (let k = 0; k < 4; k++) for (let s = 0; s <= stepsPerQuad; s++) {
    const brg = ((k * 90 + (s / stepsPerQuad) * 90) * Math.PI) / 180;
    const rKm = q[k] * nmKm;
    out.push([lon + (rKm * Math.sin(brg)) / (kmPerDegLat * Math.cos((lat * Math.PI) / 180)), lat + (rKm * Math.cos(brg)) / kmPerDegLat]);
  }
  out.push(out[0]);
  return out;
}

/**
 * Time-sliced cone circle (NHC 2026 radii) for the slider time: radius from the advisory's tau at t.
 * Null before the advisory's synoptic time (the past has no cone).
 */
export function coneCircleAt(adv: AdvisoryRecord | null, stormId: string, t: number): { tau: number; radiusMi: number } | null {
  if (!adv || adv.kind !== "full") return null;
  const syn = adv.synopticUTC ? Date.parse(adv.synopticUTC) : Date.parse(adv.points[0]?.validUTC ?? "") - (adv.points[0]?.tau ?? 0) * 3.6e6;
  if (!isFinite(syn) || t <= syn) return null;
  const tau = (t - syn) / 3.6e6;
  const last = adv.points[adv.points.length - 1]?.tau ?? 120;
  if (tau > last + 0.01) return null;
  return { tau, radiusMi: coneRadiusMi(tau, basinOf(stormId)) };
}

/** Slider range = [min valid time, max valid time] of the track, with the past capped to `maxPastH` hours before now. */
export function sliderRange(track: TrackPoint[], now: number, maxPastH = 72): [number, number] {
  if (!track.length) return [now, now];
  return [Math.max(track[0].time, now - maxPastH * 3.6e6), Math.max(track[track.length - 1].time, now)];
}

/** Human label for an advisory in the selector. */
export function advisoryLabel(a: { advNum: string; kind: string; issuedUTC: string }): string {
  const when = new Date(a.issuedUTC).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";
  if (a.advNum.startsWith("OFCL")) return `Forecast issued ${when} (from NHC forecast archive)`;
  return `Advisory ${a.advNum}${a.kind === "intermediate" ? " (position update)" : ""}, ${when}`;
}
export { gcInterp };
