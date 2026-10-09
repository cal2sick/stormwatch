// Geodesy helpers: haversine distance, bearing, point-in-polygon, closest approach. Pure functions (unit-tested).
const R_MI = 3958.7613;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const POINTS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export const cardinal = (b: number) => POINTS[Math.round(b / 22.5) % 16];

/** Saffir-Simpson from knots (NHC intensity unit). */
export const categoryFromKt = (kt: number | null) =>
  kt == null ? "—" : kt >= 137 ? "CAT 5" : kt >= 113 ? "CAT 4" : kt >= 96 ? "CAT 3" : kt >= 83 ? "CAT 2" : kt >= 64 ? "CAT 1" : kt >= 34 ? "TS" : "TD";

type Ring = number[][]; // [lon, lat][]
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Point in Polygon / MultiPolygon (GeoJSON coordinates), holes respected. */
export function pointInGeometry(lon: number, lat: number, g: GeoJSON.Geometry): boolean {
  const polys: Ring[][] = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)));
}

/** Local flat projection around an origin, in miles (fine for a few hundred miles). */
export function toLocal(oLat: number, oLon: number, lat: number, lon: number): [number, number] {
  const k = 69.0936; // mi per degree latitude (mean)
  return [(lon - oLon) * k * Math.cos(rad(oLat)), (lat - oLat) * k];
}

/** Closest point of approach to home if the storm kept its current motion (straight line). */
export function motionCpa(home: { lat: number; lon: number }, s: { lat: number; lon: number; dirDeg: number; speedMph: number; time: string | null }) {
  const [x, y] = toLocal(home.lat, home.lon, s.lat, s.lon);
  const vx = s.speedMph * Math.sin(rad(s.dirDeg)), vy = s.speedMph * Math.cos(rad(s.dirDeg));
  const v2 = vx * vx + vy * vy;
  const now = Math.hypot(x, y);
  if (v2 === 0) return { time: null, distanceMi: now, receding: false };
  const tH = -(x * vx + y * vy) / v2;
  if (tH <= 0) return { time: null, distanceMi: now, receding: true };
  const d = Math.hypot(x + vx * tH, y + vy * tH);
  const t0 = s.time ? Date.parse(s.time) : Date.now();
  return { time: new Date(t0 + tH * 3_600_000).toISOString(), distanceMi: d, receding: false };
}

/** Closest approach along a timed track (linear interpolation between points). */
export function trackCpa(home: { lat: number; lon: number }, pts: { lat: number; lon: number; time: string }[]) {
  if (pts.length === 0) return null;
  let best = { time: pts[0].time, distanceMi: distanceMi(home.lat, home.lon, pts[0].lat, pts[0].lon), receding: false };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ta = Date.parse(a.time), tb = Date.parse(b.time);
    for (let k = 1; k <= 60; k++) {
      const f = k / 60;
      const lat = a.lat + (b.lat - a.lat) * f, lon = a.lon + (b.lon - a.lon) * f;
      const d = distanceMi(home.lat, home.lon, lat, lon);
      if (d < best.distanceMi) best = { time: new Date(ta + (tb - ta) * f).toISOString(), distanceMi: d, receding: false };
    }
  }
  best.receding = best.time === pts[0].time;
  return best;
}

/**
 * Parameter t (in units of |S→H|) where the ray from S toward H first crosses a polyline, or null.
 * Coordinates are [lon, lat]; computed in a local flat projection around S.
 */
export function rayCrossing(sLat: number, sLon: number, hLat: number, hLon: number, line: number[][]): number | null {
  const [hx, hy] = toLocal(sLat, sLon, hLat, hLon);
  let best: number | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = toLocal(sLat, sLon, line[i][1], line[i][0]);
    const [bx, by] = toLocal(sLat, sLon, line[i + 1][1], line[i + 1][0]);
    const ex = bx - ax, ey = by - ay;
    const den = hx * ey - hy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den;      // along S→H
    const u = (ax * hy - ay * hx) / den;      // along segment
    if (t >= 0 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

/** Minimum distance (mi) from a point to a polyline ([lon, lat] coords). */
export function distToLineMi(lat: number, lon: number, line: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = toLocal(lat, lon, line[i][1], line[i][0]);
    const [bx, by] = toLocal(lat, lon, line[i + 1][1], line[i + 1][0]);
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * ex + ay * ey) / l2));
    best = Math.min(best, Math.hypot(ax + u * ex, ay + u * ey));
  }
  return best;
}

/**
 * Arrival time at H from timed isochrones of a wind field expanding outward from storm center S
 * (NHC 34-kt time-of-arrival product). For each isochrone we test the ray S→H:
 *   crossing before H (t < 1)  → the field has NOT reached H by that time;
 *   crossing at/after H (t ≥ 1) → H is inside the field by that time.
 * The arrival is interpolated by H's distance to the bracketing isochrones. If H sits past the
 * end of the next isochrone (edge of the swath) we still interpolate when that line is within
 * `edgeMi`; if not, we return the last passed isochrone as a lower bound ("after"), or null when
 * H is far outside the swath (no 34-kt arrival forecast in the product window).
 */
export function arrivalFromIsochrones(s: { lat: number; lon: number }, h: { lat: number; lon: number }, iso: { time: string; line: number[][] }[], edgeMi = 75) {
  const rows = iso
    .map((i) => ({ time: Date.parse(i.time), t: rayCrossing(s.lat, s.lon, h.lat, h.lon, i.line), d: distToLineMi(h.lat, h.lon, i.line) }))
    .sort((a, b) => a.time - b.time);
  if (rows.length === 0) return null;
  const firstReached = rows.findIndex((r) => r.t !== null && r.t >= 1);
  let lastNotYet = -1;
  rows.forEach((r, i) => { if (r.t !== null && r.t < 1 && (firstReached === -1 || i < firstReached)) lastNotYet = i; });
  if (lastNotYet === -1) {
    return firstReached === -1 ? null : { time: new Date(rows[firstReached].time).toISOString(), bound: "before" as const };
  }
  const a = rows[lastNotYet];
  const b = firstReached > lastNotYet ? rows[firstReached] : rows[lastNotYet + 1];
  // Edge of the swath: H is past isochrone `a` but the next one doesn't reach H. Report a lower bound.
  if (!b || (firstReached <= lastNotYet && b.d > edgeMi)) {
    return a.d <= edgeMi * 2 ? { time: new Date(a.time).toISOString(), bound: "after" as const } : null;
  }
  const f = a.d / (a.d + b.d || 1);
  return { time: new Date(a.time + (b.time - a.time) * f).toISOString(), bound: "at" as const };
}
