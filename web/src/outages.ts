// Pure outage helpers (v0.6), shared by the panels, the map and the tests.
export interface UtilityRow {
  id: string; name: string; kind: "live" | "county" | "link";
  out: number | null; outages: number | null; served: number | null; servedSource: string | null; pct: number | null;
  etr: string | null; etrPassed: number; source: string; sourceTime: string | null; map: string | null;
  bbox: [number, number, number, number] | null; note: string | null;
}
export interface OutageAreas {
  checked: string; stops: number[]; utilities: UtilityRow[];
  regions: GeoJSON.FeatureCollection | null; regionNote: string | null;
  counties: GeoJSON.FeatureCollection | null; countyNote: string;
  points: { lat: number; lon: number; customers: number; cause: string | null; etr: string | null; source: string }[];
  history: { hours: number; series: Record<string, { t: string; v: number }[]> };
  compare: Record<string, string>;
}

/** One legend for every outage shading (% of customers out). */
export const OUTAGE_STOPS = [0, 10, 30, 60, 100];
export const OUTAGE_COLORS = ["#ffe066", "#fd9b3c", "#e8590c", "#c92a2a", "#6b0f0f"]; // >0, >=10, >=30, >=60, 100
export function outageColor(pct: number | null | undefined): string | null {
  if (pct == null || !(pct > 0)) return null;
  if (pct >= 100) return OUTAGE_COLORS[4];
  if (pct >= 60) return OUTAGE_COLORS[3];
  if (pct >= 30) return OUTAGE_COLORS[2];
  if (pct >= 10) return OUTAGE_COLORS[1];
  return OUTAGE_COLORS[0];
}
/** MapLibre expression with the same steps as outageColor (null pct -> transparent). */
export const OUTAGE_FILL_EXPR: any = ["case", ["any", ["!", ["has", "pct"]], ["==", ["get", "pct"], null], ["<=", ["to-number", ["get", "pct"], 0], 0]], "rgba(0,0,0,0)",
  ["step", ["to-number", ["get", "pct"], 0], OUTAGE_COLORS[0], 10, OUTAGE_COLORS[1], 30, OUTAGE_COLORS[2], 60, OUTAGE_COLORS[3], 100, OUTAGE_COLORS[4]]];

export const inBox = (b: UtilityRow["bbox"], p: { lat: number; lon: number }, pad = 0) =>
  !!b && p.lon >= b[0] - pad && p.lat >= b[1] - pad && p.lon <= b[2] + pad && p.lat <= b[3] + pad;

export const fmtPct = (p: number | null | undefined) => p == null ? "—" : p === 0 ? "0%" : p < 0.01 ? "<0.01%" : p < 1 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`;
export function minutesAgo(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN; if (!Number.isFinite(t)) return "time unknown";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 1 ? "updated just now" : m < 60 ? `updated ${m} min ago` : `updated ${Math.floor(m / 60)} h ${m % 60} min ago`;
}

/** Utilities that serve around a point (all of them when there is no point), live feeds first, most out first. */
export function utilitiesFor(rows: UtilityRow[], p: { lat: number; lon: number } | null): UtilityRow[] {
  const here = p ? rows.filter((r) => inBox(r.bbox, p, 0.05)) : rows;
  const rank = (r: UtilityRow) => (r.kind === "live" && r.out != null ? 0 : r.kind === "live" ? 1 : 2);
  return [...here].sort((a, b) => rank(a) - rank(b) || (b.out ?? -1) - (a.out ?? -1) || a.name.localeCompare(b.name));
}

export interface Headline { label: string; out: number | null; served: number | null; pct: number | null; sourceTime: string | null; ids: string[]; partial: string[]; servedSource: string | null }
/** Big number for a place: sum of LIVE utility feeds that cover it. Utilities without a free feed are listed as missing, never guessed. */
export function headlineFor(rows: UtilityRow[], p: { lat: number; lon: number } | null, placeName: string | null): Headline | null {
  const here = utilitiesFor(rows, p);
  const live = here.filter((r) => r.kind === "live" && r.out != null);
  const partial = here.filter((r) => !(r.kind === "live" && r.out != null)).map((r) => r.name);
  if (!live.length) return here.length ? { label: placeName ?? "This area", out: null, served: null, pct: null, sourceTime: null, ids: [], partial, servedSource: null } : null;
  const out = live.reduce((a, r) => a + (r.out ?? 0), 0);
  const served = live.every((r) => r.served) ? live.reduce((a, r) => a + (r.served ?? 0), 0) : null;
  const times = live.map((r) => r.sourceTime).filter(Boolean).sort() as string[];
  return { label: live.map((r) => r.name).join(" + "), out, served, pct: served ? Math.round((out / served) * 10000) / 100 : null,
    sourceTime: times[0] ?? null, ids: live.map((r) => r.id), partial, servedSource: live.map((r) => r.servedSource).filter(Boolean)[0] ?? null };
}

/** Sum the history of several sources per poll time. */
export function sumSeries(series: OutageAreas["history"]["series"], ids: string[]): { t: number; v: number }[] {
  const by = new Map<string, number>();
  for (const id of ids) for (const pt of series[id] ?? []) by.set(pt.t, (by.get(pt.t) ?? 0) + pt.v);
  return [...by].map(([t, v]) => ({ t: Date.parse(t), v })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
}
/** SVG polyline points over a fixed 24-hour window ending now. */
export function sparkPoints(pts: { t: number; v: number }[], w: number, h: number, now = Date.now(), hours = 24): string {
  const t0 = now - hours * 3.6e6, max = Math.max(1, ...pts.map((p) => p.v));
  return pts.filter((p) => p.t >= t0).map((p) => `${(((p.t - t0) / (now - t0)) * w).toFixed(1)},${(h - (p.v / max) * (h - 2) - 1).toFixed(1)}`).join(" ");
}
export function trend(pts: { t: number; v: number }[], now = Date.now()): { peak: number | null; peakAt: number | null; dir: "rising" | "restoring" | "steady" | null; hourAgo: number | null } {
  if (!pts.length) return { peak: null, peakAt: null, dir: null, hourAgo: null };
  const pk = pts.reduce((a, b) => (b.v > a.v ? b : a));
  const latest = pts.at(-1)!;
  const ago = [...pts].reverse().find((p) => p.t <= now - 50 * 60_000) ?? null;
  const dir = !ago ? null : latest.v > ago.v * 1.1 + 2 ? "rising" : latest.v < ago.v * 0.9 - 2 ? "restoring" : "steady";
  return { peak: pk.v, peakAt: pk.t, dir, hourAgo: ago?.v ?? null };
}
export const compareUrl = (fips: string | null | undefined, c: Record<string, string>) => (fips && (c[fips] ?? c[fips.slice(0, 2)])) || c.default || "https://poweroutage.us/";
