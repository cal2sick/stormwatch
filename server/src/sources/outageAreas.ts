// Outage areas (v0.6): utility-wide totals, % out, region and county shading, and a 24-hour history
// built ONLY from our own polls of free public feeds (config/outage-sources.json + ORNL ODIN).
// Never fetches PowerOutage.us, Duke, Talquin or FPL: those are link-only.
// PRIVACY: everything here is utility- or county-level. No user location is used or stored.
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import { arcgisToOutages, cachedFeed, getJsonNoCache, loadOutageConfig, ODIN_URL, type OutageConfig, type OutageSource } from "./place.js";

/** One legend for every outage shading: % of customers out. */
export const OUTAGE_STOPS = [0, 10, 30, 60, 100] as const;

export interface UtilityRow {
  id: string; name: string; kind: "live" | "county" | "link";
  out: number | null; outages: number | null; served: number | null; servedSource: string | null; pct: number | null;
  etr: string | null; etrPassed: number; source: string; sourceTime: string | null; map: string | null;
  bbox: [number, number, number, number] | null; note: string | null;
}
export interface HistPoint { t: string; out: Record<string, number> }
export interface OutageAreas {
  checked: string; stops: readonly number[];
  utilities: UtilityRow[];
  regions: GeoJSON.FeatureCollection | null; regionNote: string | null;
  counties: GeoJSON.FeatureCollection | null; countyNote: string;
  points: { lat: number; lon: number; customers: number; cause: string | null; etr: string | null; source: string }[];
  history: { hours: number; series: Record<string, { t: string; v: number }[]> };
  compare: Record<string, string>;
}

export const pct = (out: number | null | undefined, served: number | null | undefined) =>
  out == null || !served || served <= 0 ? null : Math.round((out / served) * 10000) / 100;

/** Outage point "region" (a number, e.g. 2) -> region shape whose NAME starts with that number ("2 East"). */
export function regionStats(regions: GeoJSON.FeatureCollection, outages: { region?: unknown; customers: number }[], served: number | null) {
  const byNum = new Map<string, { out: number; n: number }>();
  for (const o of outages) { const k = String(o.region ?? "").trim(); const c = byNum.get(k) ?? { out: 0, n: 0 }; c.out += o.customers; c.n++; byNum.set(k, c); }
  let unmatched = 0;
  const known = new Set<string>();
  const features = regions.features.map((f) => {
    const name = String((f.properties as any)?.NAME ?? "");
    const num = name.match(/^(\d+)/)?.[1] ?? name; known.add(num);
    const s = byNum.get(num) ?? { out: 0, n: 0 };
    return { ...f, properties: { name, out: s.out, outages: s.n, pct: pct(s.out, served) } } as GeoJSON.Feature;
  });
  for (const [k, v] of byNum) if (!known.has(k)) unmatched += v.out;
  return { fc: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection, unmatched };
}

/** ODIN rows -> per-county totals. % only when ODIN itself reports meters served (most utilities do not). */
export function odinCounties(odin: any, eia: OutageConfig["eia861"]) {
  const by = new Map<string, { fips: string; out: number; served: number | null; utilities: { name: string; out: number; eiaId: string | null; utilityCustomers: number | null }[] }>();
  for (const o of odin?.outage ?? []) {
    const fips = String(o.communityDescriptor ?? ""); if (!/^\d{5}$/.test(fips)) continue;
    const id = o.names?.find((n: any) => n.nameType === "UtilityId")?.name ?? null;
    const name = (id && eia[id]?.[0]) || (o.names?.find((n: any) => n.nameType === "UtilityName")?.name ?? "Unknown utility");
    const out = Number(o.metersAffected ?? 0) || 0, srv = Number(o.outageArea?.metersServed ?? o.originalCustomersServed ?? 0) || 0;
    const c = by.get(fips) ?? { fips, out: 0, served: null, utilities: [] };
    c.out += out; if (srv > 0) c.served = (c.served ?? 0) + srv;
    c.utilities.push({ name, out, eiaId: id, utilityCustomers: id && eia[id] ? eia[id][1] : null });
    by.set(fips, c);
  }
  return [...by.values()];
}

/** Latest estimated restoration among current outages, and how many already passed their estimate. */
export function etrSummary(outs: { etr: string | null; etrPassed: boolean }[]) {
  const future = outs.filter((o) => o.etr && !o.etrPassed).map((o) => o.etr!).sort();
  return { etr: future.at(-1) ?? null, passed: outs.filter((o) => o.etrPassed).length };
}

// ---------- history (our own polls, data/outage-history.jsonl) ----------
const HIST = () => path.join(DATA_DIR, "outage-history.jsonl");
export function parseHistory(text: string, sinceMs: number): HistPoint[] {
  return text.split("\n").filter(Boolean).flatMap((l) => { try { const p = JSON.parse(l); return p && typeof p.t === "string" && Date.parse(p.t) >= sinceMs ? [p as HistPoint] : []; } catch { return []; } });
}
export function seriesFrom(points: HistPoint[], sinceMs: number) {
  const s: Record<string, { t: string; v: number }[]> = {};
  for (const p of points) if (Date.parse(p.t) >= sinceMs) for (const [k, v] of Object.entries(p.out)) (s[k] ??= []).push({ t: p.t, v });
  return s;
}
function readHistory(sinceMs: number) { try { return existsSync(HIST()) ? parseHistory(readFileSync(HIST(), "utf8"), sinceMs) : []; } catch { return []; } }
function appendHistory(p: HistPoint, keepHours: number) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(HIST(), JSON.stringify(p) + "\n");
    // Prune about once an hour: keep the last keepHours.
    if (new Date(p.t).getUTCMinutes() < 4) { const keep = readHistory(Date.now() - keepHours * 3.6e6); writeFileSync(HIST(), keep.map((x) => JSON.stringify(x)).join("\n") + "\n"); }
  } catch { /* history is best effort */ }
}

// ---------- fetch + build ----------
const geomCache = new Map<string, { at: number; fc: GeoJSON.FeatureCollection }>();
async function cachedGeom(key: string, url: string): Promise<GeoJSON.FeatureCollection | null> {
  const c = geomCache.get(key);
  if (c && Date.now() - c.at < 24 * 3.6e6) return c.fc;
  try { const fc = await getJsonNoCache<GeoJSON.FeatureCollection>(url, "application/geo+json, application/json", 30_000); if (fc?.features) { geomCache.set(key, { at: Date.now(), fc }); return fc; } } catch { /* keep old */ }
  return c?.fc ?? null;
}
const countyUrl = (fips: string[]) => `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?where=${encodeURIComponent(`GEOID IN (${fips.map((f) => `'${f}'`).join(",")})`)}&outFields=GEOID,NAME&outSR=4326&maxAllowableOffset=0.01&f=geojson`;

let last: OutageAreas | null = null;
let building: Promise<OutageAreas> | null = null;

async function build(cfg: OutageConfig, record: boolean): Promise<OutageAreas> {
  const ttl = cfg.pollSeconds * 1000;
  const utilities: UtilityRow[] = []; const points: OutageAreas["points"] = [];
  let regions: GeoJSON.FeatureCollection | null = null, regionNote: string | null = null;
  const histOut: Record<string, number> = {};
  for (const s of cfg.sources) { // one at a time, never in parallel
    const base: Omit<UtilityRow, "kind" | "out" | "outages" | "pct" | "etr" | "etrPassed" | "sourceTime" | "note"> = {
      id: s.id, name: s.name, served: s.served ?? null, servedSource: s.served ? s.servedSource ?? "utility-published total" : null,
      source: s.credit ?? s.name, map: s.map ?? null, bbox: s.bbox ?? null };
    if (s.type !== "arcgis") { utilities.push({ ...base, kind: "link", out: null, outages: null, pct: null, etr: null, etrPassed: 0, sourceTime: null, note: "No free live feed. Open the utility's own map." }); continue; }
    try {
      const raw = await cachedFeed<any>(`arcgis:${s.id}`, ttl, () => getJsonNoCache<any>(s.url!));
      if (raw?.error) throw new Error("arcgis error");
      const outs = arcgisToOutages(raw, { lat: 0, lon: 0 });
      const regionAttr = (raw.features ?? []).filter((f: any) => f.geometry).map((f: any) => ({ region: f.attributes?.region, customers: Number(f.attributes?.customers ?? 0) || 0 }));
      let sourceTime: string | null = null;
      if (s.timeUrl) try { const t = await cachedFeed<any>(`time:${s.id}`, ttl, () => getJsonNoCache<any>(s.timeUrl!)); const ms = Number(t?.features?.[0]?.attributes?.TIMESTAMP); if (ms > 1e12) sourceTime = new Date(ms).toISOString(); } catch { /* use fetch time */ }
      const out = outs.reduce((a, o) => a + o.customers, 0); const e = etrSummary(outs);
      utilities.push({ ...base, kind: "live", out, outages: outs.length, pct: pct(out, s.served), etr: e.etr, etrPassed: e.passed, sourceTime: sourceTime ?? new Date().toISOString(),
        note: sourceTime ? null : "Time = when we checked (the feed has no timestamp)." });
      outs.forEach((o) => points.push({ lat: o.lat, lon: o.lon, customers: o.customers, cause: o.cause, etr: o.etr, source: s.name }));
      histOut[s.id] = out;
      if (s.regionsUrl) {
        const g = await cachedGeom(`regions:${s.id}`, s.regionsUrl);
        if (g) { const r = regionStats(g, regionAttr, s.served ?? null); regions = r.fc; regionNote = `${s.regionNote ?? ""} Region shading = customers out in the region as a share of all ${s.name} customers (${s.servedSource ?? "published total"}), so the share inside one region can be higher.${r.unmatched ? ` ${r.unmatched} customers are in outages outside the drawn regions.` : ""}`.trim(); }
      }
    } catch { utilities.push({ ...base, kind: "live", out: null, outages: null, pct: null, etr: null, etrPassed: 0, sourceTime: null, note: "Feed not reachable right now." }); }
  }
  // County level: ORNL ODIN (public), shaded only where ODIN reports meters served.
  let counties: GeoJSON.FeatureCollection | null = null;
  try {
    const odin = await cachedFeed<any>("odin", Math.max(ttl, 600_000), () => getJsonNoCache<any>(ODIN_URL, "application/json", 30_000));
    const cs = odinCounties(odin, cfg.eia861).filter((c) => /^(01|12|13|22|28|45|48)/.test(c.fips)); // Gulf + Southeast states
    if (cs.length) {
      const g = await cachedGeom(`counties:${cs.map((c) => c.fips).sort().join(",")}`, countyUrl(cs.map((c) => c.fips)));
      counties = { type: "FeatureCollection", features: (g?.features ?? []).flatMap((f) => {
        const c = cs.find((x) => x.fips === String((f.properties as any)?.GEOID)); if (!c) return [];
        return [{ ...f, properties: { fips: c.fips, name: String((f.properties as any)?.NAME ?? c.fips), out: c.out, pct: pct(c.out, c.served), utilities: JSON.stringify(c.utilities) } } as GeoJSON.Feature];
      }) };
      for (const c of cs) histOut[`odin:${c.fips}`] = c.out;
    }
  } catch { counties = last?.counties ?? null; }
  const now = new Date().toISOString();
  if (record && Object.keys(histOut).length) appendHistory({ t: now, out: histOut }, cfg.historyHours);
  const since = Date.now() - 24 * 3.6e6;
  return {
    checked: now, stops: OUTAGE_STOPS, utilities, regions, regionNote, counties,
    countyNote: "County outlines: ORNL ODIN (Outage Data Initiative Nationwide), only utilities that report to it. Shaded by % only where ODIN gives the number of meters served; otherwise outlined with the count.",
    points, history: { hours: 24, series: seriesFrom(readHistory(since), since) }, compare: cfg.compare,
  };
}

/** Cached view for the browser. Rebuilt at most once per poll interval. */
export async function getOutageAreas(): Promise<OutageAreas> {
  const cfg = loadOutageConfig();
  if (last && Date.now() - Date.parse(last.checked) < cfg.pollSeconds * 1000) return last;
  building ??= build(cfg, false).then((r) => (last = r)).finally(() => { building = null; });
  return building;
}

/** Background poll: one snapshot per poll interval, appended to data/outage-history.jsonl (utility totals only). */
export function startOutageHistory() {
  const tick = async () => {
    const cfg = loadOutageConfig();
    try { if (!building) { building = build(cfg, true).then((r) => (last = r)).finally(() => { building = null; }); await building; } } catch { /* keep going */ }
    setTimeout(tick, cfg.pollSeconds * 1000);
  };
  setTimeout(tick, 9000);
}

export const compareUrlFor = (fips: string | null | undefined, compare: Record<string, string>) =>
  (fips && (compare[fips] ?? compare[fips.slice(0, 2)])) || compare.default || "https://poweroutage.us/";
export type { OutageSource };
