// Location search + per-location lookups for the browser's "selected location".
// PRIVACY: nothing here is logged or written to disk. Routes using these run with logLevel "warn"
// (no request lines), errors are reduced to a generic message, and nothing is cached by address.
import { readFileSync } from "node:fs";
import path from "node:path";
import { USER_AGENT, ROOT } from "../config.js";
import { distanceMi } from "../geo.js";
import type { Forecast, NwsAlert, Outage } from "../types.js";

const UA = { "User-Agent": USER_AGENT, Accept: "application/json" };
export async function getJsonNoCache<T>(url: string, accept = "application/json", timeoutMs = 15_000): Promise<T> {
  const r = await fetch(url, { headers: { ...UA, Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export interface GeoResult { name: string; lat: number; lon: number; source: "US Census Geocoder" | "OpenStreetMap Nominatim" }

/** Clean a user query: trim, collapse spaces, cap length. Returns null if unusable. */
export function cleanQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const s = q.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return s.length >= 3 ? s : null;
}

export function parseCensus(d: any): GeoResult[] {
  return (d?.result?.addressMatches ?? []).slice(0, 5).map((m: any) => ({ name: String(m.matchedAddress ?? ""), lat: Number(m.coordinates?.y), lon: Number(m.coordinates?.x), source: "US Census Geocoder" as const }))
    .filter((r: GeoResult) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}
export function parseNominatim(d: any): GeoResult[] {
  return (Array.isArray(d) ? d : []).slice(0, 5).map((m: any) => ({ name: String(m.display_name ?? "").replace(/, United States$/, ""), lat: Number(m.lat), lon: Number(m.lon), source: "OpenStreetMap Nominatim" as const }))
    .filter((r: GeoResult) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

// Nominatim policy: max 1 request per second (whole app), real User-Agent, no autocomplete.
let nextNominatim = 0;
async function nominatimSlot() {
  const wait = nextNominatim - Date.now();
  nextNominatim = Math.max(Date.now(), nextNominatim) + 1100;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** US Census Geocoder first (street addresses), then OpenStreetMap Nominatim (cities, ZIPs, places). */
export async function geocode(q: string): Promise<GeoResult[]> {
  try {
    const c = parseCensus(await getJsonNoCache(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`));
    if (c.length) return c;
  } catch { /* fall back */ }
  await nominatimSlot();
  return parseNominatim(await getJsonNoCache(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&q=${encodeURIComponent(q)}`));
}

export function validLatLon(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const a = Number(lat), o = Number(lon);
  return Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 ? { lat: Math.round(a * 1e4) / 1e4, lon: Math.round(o * 1e4) / 1e4 } : null;
}

/** NWS hourly wind + active alerts for any point (no disk cache, unlike the home point). */
export async function placeWeather(p: { lat: number; lon: number }): Promise<{ forecast: Forecast | null; alerts: NwsAlert[]; office: string | null }> {
  const g = "application/geo+json";
  const pts = await getJsonNoCache<{ properties: Record<string, any> }>(`https://api.weather.gov/points/${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, g);
  const [hourly, grid, al] = await Promise.all([
    getJsonNoCache<{ properties: { updateTime?: string; periods: any[] } }>(pts.properties.forecastHourly, g).catch(() => null),
    getJsonNoCache<{ properties: Record<string, any> }>(pts.properties.forecastGridData, g).catch(() => null),
    getJsonNoCache<{ features: { id: string; properties: Record<string, any> }[] }>(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, g).catch(() => null),
  ]);
  const now = Date.now();
  const gust = (grid?.properties?.windGust?.values ?? []).map((v: any) => { const [s, d] = String(v.validTime).split("/"); const t0 = Date.parse(s); const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/.exec(d ?? ""); const h = m ? Number(m[1] ?? 0) * 24 + Number(m[2] ?? 1) : 1; return { t0, t1: t0 + h * 3.6e6, v: v.value as number | null }; });
  const gUom = String(grid?.properties?.windGust?.uom ?? "");
  const toMph = (v: number) => (/km_h/.test(gUom) ? v * 0.621371 : /m_s/.test(gUom) ? v * 2.23694 : /kt/.test(gUom) ? v * 1.15078 : v);
  const hourlyPts = (hourly?.properties.periods ?? []).filter((x) => Date.parse(x.endTime) > now).slice(0, 48).map((x) => {
    const t = Date.parse(x.startTime); const gg = gust.find((s: any) => t >= s.t0 && t < s.t1);
    const n = String(x.windSpeed ?? "").match(/\d+/g);
    return { time: new Date(t).toISOString(), tempF: x.temperature ?? null, windMph: n ? Math.max(...n.map(Number)) : null,
      gustMph: gg?.v != null ? Math.round(toMph(gg.v)) : null, windDir: x.windDirection ?? null, pop: x.probabilityOfPrecipitation?.value ?? null, shortForecast: x.shortForecast ?? "" };
  });
  const gusts = hourlyPts.map((h) => h.gustMph).filter((x): x is number => x != null);
  const alerts: NwsAlert[] = (al?.features ?? []).map((f) => { const q = f.properties; return { id: f.id, event: q.event, severity: q.severity, urgency: q.urgency, certainty: q.certainty,
    headline: q.headline ?? null, description: q.description ?? "", instruction: q.instruction ?? null, onset: q.onset ?? null, expires: q.expires ?? null, ends: q.ends ?? null, sent: q.sent ?? null, senderName: q.senderName ?? null }; });
  return { office: pts.properties.gridId ?? null, alerts,
    forecast: hourly ? { office: pts.properties.gridId ?? null, hourly: hourlyPts, qpf24In: null, qpf48In: null, maxGust48Mph: gusts.length ? Math.max(...gusts) : null, updateTime: hourly.properties.updateTime ?? null } as Forecast : null };
}

// ---------- Outages around a point ----------
export interface OutageSource { id: string; type: "arcgis" | "link" | "odin"; name: string; bbox?: [number, number, number, number]; url?: string; map?: string; credit?: string;
  /** Customers served (EIA-861 or the utility's own published total) and where that number comes from. */
  eiaId?: number; served?: number; servedSource?: string; regionsUrl?: string; timeUrl?: string; regionNote?: string }
export interface OutageConfig { pollSeconds: number; radiusMi: number; sources: OutageSource[]; historyHours: number;
  eia861: Record<string, [string, number]>; compare: Record<string, string> }
export function loadOutageConfig(): OutageConfig {
  try {
    const d = JSON.parse(readFileSync(path.join(ROOT, "config", "outage-sources.json"), "utf8"));
    const sources = (Array.isArray(d.sources) ? d.sources : []).filter((s: any) => typeof s?.id === "string" && ["arcgis", "link"].includes(s.type) && typeof s.name === "string"
      && (s.type !== "arcgis" || (typeof s.url === "string" && /^https:\/\//.test(s.url))));
    const httpsOnly = (o: any) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => !k.startsWith("_") && typeof v === "string" && /^https:\/\//.test(v as string))) as Record<string, string>;
    const eia = Object.fromEntries(Object.entries(d.eia861 ?? {}).filter(([k, v]) => /^\d+$/.test(k) && Array.isArray(v))) as Record<string, [string, number]>;
    return { pollSeconds: Math.max(120, Number(d.pollSeconds) || 180), radiusMi: Math.min(100, Math.max(1, Number(d.radiusMi) || 25)), sources,
      historyHours: Math.min(24 * 14, Math.max(24, Number(d.historyHours) || 168)), eia861: eia, compare: httpsOnly(d.compare) };
  } catch { return { pollSeconds: 180, radiusMi: 25, sources: [], historyHours: 168, eia861: {}, compare: {} }; }
}
export const inBbox = (b: OutageSource["bbox"], p: { lat: number; lon: number }, padDeg = 0.4) =>
  !b || (p.lon >= b[0] - padDeg && p.lat >= b[1] - padDeg && p.lon <= b[2] + padDeg && p.lat <= b[3] + padDeg);

/** Feeds are fetched whole and cached per source for pollSeconds, so many users/locations = still one request per source per poll. */
export const feedCache = new Map<string, { at: number; data: unknown }>();
export async function cachedFeed<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const c = feedCache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.data as T;
  const data = await load(); feedCache.set(key, { at: Date.now(), data }); return data;
}

export function arcgisToOutages(r: any, p: { lat: number; lon: number }, now = Date.now()): Outage[] {
  return (r?.features ?? []).filter((f: any) => f.geometry && Number.isFinite(f.geometry.x) && Number.isFinite(f.geometry.y)).map((f: any) => {
    const a = f.attributes ?? {}, lat = f.geometry.y, lon = f.geometry.x;
    return { lat, lon, customers: Number(a.customers ?? a.CUSTOMERS ?? 0) || 0, status: a.status ?? null, cause: a.cause ?? null, type: a.outagetype ?? null,
      off: a.off ? new Date(a.off).toISOString() : null, etr: a.etr ? new Date(a.etr).toISOString() : null, etrPassed: a.etr ? a.etr < now : false,
      distanceMi: Math.round(distanceMi(p.lat, p.lon, lat, lon) * 10) / 10 } as Outage;
  });
}

export const ODIN_URL = "https://odin.ornl.gov/odi?format=JSON";
export async function countyFips(p: { lat: number; lon: number }): Promise<{ fips: string; name: string } | null> {
  const d = await getJsonNoCache<any>(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${p.lon}&y=${p.lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`);
  const c = d?.result?.geographies?.Counties?.[0];
  return c ? { fips: String(c.GEOID), name: String(c.NAME) } : null;
}

export interface NearbyOutages {
  radiusMi: number; pollSeconds: number; checked: string;
  outages: (Outage & { source: string })[]; totalCustomers: number;
  feeds: { name: string; status: "ok" | "error"; count: number; credit?: string; map?: string }[];
  county: { name: string; fips: string; rows: { utility: string; customers: number }[]; source: string; compareUrl?: string } | null;
  links: { name: string; url: string }[];
  coverage: "point-feed" | "county-only" | "none";
  note: string;
}

export async function nearbyOutages(p: { lat: number; lon: number }, cfg = loadOutageConfig()): Promise<NearbyOutages> {
  const ttl = cfg.pollSeconds * 1000;
  const here = cfg.sources.filter((s) => inBbox(s.bbox, p));
  const feeds: NearbyOutages["feeds"] = []; const outages: NearbyOutages["outages"] = [];
  for (const s of here.filter((x) => x.type === "arcgis")) { // one at a time, never in parallel
    try {
      const r = await cachedFeed(`arcgis:${s.id}`, ttl, () => getJsonNoCache<any>(s.url!));
      if (r?.error) throw new Error("arcgis error");
      const near = arcgisToOutages(r, p).filter((o) => o.distanceMi <= cfg.radiusMi);
      near.forEach((o) => outages.push({ ...o, source: s.name }));
      feeds.push({ name: s.name, status: "ok", count: near.length, credit: s.credit, map: s.map });
    } catch { feeds.push({ name: s.name, status: "error", count: 0, credit: s.credit, map: s.map }); }
  }
  // County-level fallback/extra: ORNL ODIN (public tier) for the county of the selected point.
  let county: NearbyOutages["county"] = null;
  try {
    const c = await countyFips(p);
    if (c) {
      const odin = await cachedFeed<any>("odin", Math.max(ttl, 600_000), () => getJsonNoCache<any>(ODIN_URL, "application/json", 30_000));
      const rows = (odin?.outage ?? []).filter((o: any) => String(o.communityDescriptor ?? "").startsWith(c.fips)).map((o: any) => ({
        utility: o.names?.find((n: any) => n.nameType === "UtilityName")?.name ?? "Unknown utility", customers: Number(o.metersAffected ?? 0) || 0 }));
      county = { name: c.name, fips: c.fips, rows, source: "ORNL ODIN (Outage Data Initiative Nationwide), county level", compareUrl: (cfg.compare[c.fips] ?? cfg.compare[c.fips.slice(0, 2)]) || cfg.compare.default };
    }
  } catch { county = null; }
  outages.sort((a, b) => a.distanceMi - b.distanceMi);
  const links = here.filter((s) => s.map).map((s) => ({ name: `${s.name} outage map`, url: s.map! }));
  
  const pointOk = feeds.some((f) => f.status === "ok");
  const coverage: NearbyOutages["coverage"] = pointOk ? "point-feed" : county?.rows.length ? "county-only" : "none";
  const linkOnly = here.filter((s) => s.type === "link").map((s) => s.name);
  const note = coverage === "none"
    ? "No free public outage feed covers this location. Check your utility's own outage map below."
    : linkOnly.length ? `Only ${feeds.filter((f) => f.status === "ok").map((f) => f.name).join(", ") || "county totals"} ${pointOk ? "has" : "have"} a free live feed here. ${linkOnly.join(", ")} ${linkOnly.length > 1 ? "do" : "does"} not, so check ${linkOnly.length > 1 ? "their" : "its"} map below.` : "";
  return { radiusMi: cfg.radiusMi, pollSeconds: cfg.pollSeconds, checked: new Date().toISOString(), outages, totalCustomers: outages.reduce((s, o) => s + o.customers, 0), feeds, county, links, coverage, note };
}
