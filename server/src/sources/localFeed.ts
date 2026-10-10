// "Latest for <place>": a newest-first list of official updates near one point.
// Sources (all free, keyless): NWS alerts for the point, the local NWS office's Hurricane Local Statement (HLS),
// short-term forecast (NOW) and special weather statements (SPS), the nearest NWS observation station, and
// NWS local storm reports (LSR) via Iowa Environmental Mesonet. No social media.
// PRIVACY: the route runs with logLevel "warn"; the point is only kept in a 2-minute in-memory cache.
import { getJsonNoCache } from "./place.js";
import { distanceMi } from "../geo.js";

export interface FeedItem { id: string; time: string; kind: "alert" | "statement" | "observation" | "report"; title: string; text: string; url: string | null; source: string;
  /** v0.7.1: full official text (verbatim) to expand; `text` is then our short plain summary. */ full?: string | null }
export interface LocalFeed { office: string | null; station: string | null; checked: string; items: FeedItem[]; errors: string[] }

const PRODUCT_TYPES: { code: string; name: string; max: number }[] = [
  { code: "HLS", name: "Hurricane Local Statement", max: 1 },
  { code: "NOW", name: "Short-term forecast", max: 1 },
  { code: "SPS", name: "Special Weather Statement", max: 2 },
];
const G = "application/geo+json";
export const productUrl = (office: string, code: string) =>
  `https://forecast.weather.gov/product.php?site=${office}&issuedby=${office}&product=${code}&format=txt&version=1&glossary=0`;
export const lsrUrl = (office: string, hours = 12) => `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?wfos=${office}&hours=${hours}`;

/** First "...HEADLINE..." block of an NWS text product, verbatim; else the first non-header paragraph. */
export function productHeadline(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const i = lines.findIndex((l) => /^\.\.\.\S/.test(l.trim()));
  if (i >= 0) {
    const out: string[] = [];
    for (let j = i; j < lines.length && j < i + 8; j++) { const l = lines[j].trim(); if (!l) break; out.push(l); if (/\.\.\.$/.test(l) && (j > i || l.length > 6)) break; }
    return out.join(" ").slice(0, 400);
  }
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 40 && !/^(\d{3}|[A-Z]{4}\d|[A-Z]{6}|URGENT|NATIONAL WEATHER SERVICE)/.test(p));
  return (paras[0] ?? "").slice(0, 400);
}

const kmh = (v: any) => (typeof v?.value === "number" ? Math.round(v.value * 0.621371) : null);
const inHg = (pa: any) => (typeof pa?.value === "number" ? pa.value / 3386.39 : null);
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const dir = (d: any) => (typeof d?.value === "number" ? DIRS[Math.round(d.value / 45) % 8] : null);

/** One plain-English line for the latest observation, with the pressure change over about the last hour. */
export function describeObs(latest: Record<string, any>, older: Record<string, any> | null): string {
  const w = kmh(latest.windSpeed), g = kmh(latest.windGust), p = inHg(latest.barometricPressure ?? latest.seaLevelPressure);
  const parts: string[] = [];
  parts.push(w == null ? "Wind not reported" : w === 0 ? "Calm" : `Wind ${dir(latest.windDirection) ? "from the " + dir(latest.windDirection) + " " : ""}${w} mph${g ? `, gusts ${g} mph` : ""}`);
  if (p != null) {
    const p0 = older ? inHg(older.barometricPressure ?? older.seaLevelPressure) : null;
    const d = p0 != null ? p - p0 : null;
    parts.push(`pressure ${p.toFixed(2)} inches${d != null && Math.abs(d) >= 0.01 ? ` (${d < 0 ? "falling" : "rising"} ${Math.abs(d).toFixed(2)} in the last hour)` : ""}`);
  }
  if (latest.textDescription) parts.push(String(latest.textDescription).toLowerCase());
  return parts.join(", ") + ".";
}

/** v0.7.1 plain 1-2 line summary of an NWS text product: its headline in sentence case, else the first paragraph. Ours, labeled as a summary. */
export function productSummary(text: string): string {
  const h = productHeadline(text).replace(/^\.+|\.+$/g, "").replace(/\.\.\./g, ". ").replace(/\s+/g, " ").trim();
  if (!h) return "";
  const lower = h === h.toUpperCase() ? h.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_m, a, b) => a + b.toUpperCase()) : h;
  const fixed = lower.replace(/\b(nws|nhc|fl|ga|al|et|edt|est|cdt|cst)\b/gi, (w) => w.toUpperCase()).replace(/\b(florida|georgia|alabama|tallahassee|gulf|atlantic|national weather service|national hurricane center)\b/gi, (w) => w.replace(/\b\w/g, (c) => c.toUpperCase()));
  const named = fixed.replace(/\b([a-z]+) (county|counties|river|bay|coast)\b/g, (_m, n, k) => n.charAt(0).toUpperCase() + n.slice(1) + " " + k.charAt(0).toUpperCase() + k.slice(1));
  return named.length > 240 ? named.slice(0, 237).replace(/\s+\S*$/, "") + "…" : named + (/[.!?]$/.test(named) ? "" : ".");
}
/** The full product body, verbatim, without the WMO header lines. */
export function productBody(text: string): string {
  const t = text.replace(/\r/g, "");
  const i = t.search(/\n\s*\n/);
  return (i > 0 && i < 200 ? t.slice(i) : t).trim().slice(0, 8000);
}
const DIR16: Record<string, string> = { N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast", SE: "southeast", SSE: "south-southeast",
  S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest", W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest" };
/** "2 NNW Farley" -> "2 mi north-northwest of Farley" (IEM report locations). */
export const lsrPlace = (city: string) => { const m = /^(\d+(?:\.\d+)?)\s+([NSEW]{1,3})\s+(.+)$/.exec(city.trim()); return m && DIR16[m[2]] ? `${m[1]} mi ${DIR16[m[2]]} of ${m[3]}` : city.trim(); };

export function parseLsr(fc: any, p: { lat: number; lon: number }, office: string, maxMi = 75, max = 8): FeedItem[] {
  const out: (FeedItem & { d: number })[] = [];
  for (const f of fc?.features ?? []) {
    const q = f.properties ?? {}; const [lon, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || !q.valid) continue;
    const d = distanceMi(p.lat, p.lon, lat, lon);
    if (q.wfo !== office && d > maxMi) continue;
    if (d > maxMi * 2) continue;
    const mag = q.magnitude && q.magnitude !== "None" ? ` ${q.magnitude}${q.unit ? " " + String(q.unit).toLowerCase() : ""}` : "";
    out.push({ id: `lsr:${q.product_id ?? ""}:${q.valid}:${lat},${lon}`, time: new Date(Date.parse(q.valid)).toISOString(), kind: "report",
      title: `${(s => s.charAt(0).toUpperCase() + s.slice(1))(String(q.typetext ?? "storm report").toLowerCase())}${mag}, ${lsrPlace(String(q.city ?? ""))}${q.st ? ", " + q.st : ""} (${Math.round(d)} miles away)`,
      text: q.remark ?? "", url: q.product_id ? `https://mesonet.agron.iastate.edu/p.php?pid=${encodeURIComponent(q.product_id)}` : null,
      source: `National Weather Service storm report (reported by ${String(q.source ?? "a spotter").toLowerCase()}), via Iowa Environmental Mesonet`, d });
  }
  return out.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, max).map(({ d: _d, ...i }) => i);
}

export function parseAlerts(d: any, p: { lat: number; lon: number }): FeedItem[] {
  return (d?.features ?? []).map((f: any) => { const a = f.properties ?? {};
    const t = a.sent ?? a.effective ?? a.onset;
    return { id: `alert:${a.id ?? f.id}`, time: new Date(Date.parse(t)).toISOString(), kind: "alert" as const,
      title: `${a.messageType === "Update" ? "Updated: " : ""}${a.event}`, text: a.headline ?? "",
      url: `https://forecast.weather.gov/MapClick.php?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`, source: a.senderName ?? "National Weather Service" };
  }).filter((i: FeedItem) => isFinite(Date.parse(i.time)));
}

/** v0.7.1: peak gust in the last 12 hours and the 3-hour pressure trend, in plain words. */
export function obsTrends(list: Record<string, any>[], t0: number): string {
  const recent = list.filter((x) => t0 - Date.parse(x.timestamp) <= 12 * 3.6e6);
  let peak: { g: number; t: string } | null = null;
  for (const x of recent) { const g = kmh(x.windGust); if (g != null && (!peak || g > peak.g)) peak = { g, t: x.timestamp }; }
  const out: string[] = [];
  if (peak) out.push(` Peak gust in the last 12 hours: ${peak.g} mph at ${new Date(peak.t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET.`);
  const p0 = inHg(list[0]?.barometricPressure ?? list[0]?.seaLevelPressure);
  const old = list.find((x) => t0 - Date.parse(x.timestamp) >= 170 * 60_000);
  const p3 = old ? inHg(old.barometricPressure ?? old.seaLevelPressure) : null;
  if (p0 != null && p3 != null) { const d = p0 - p3; out.push(Math.abs(d) < 0.02 ? " Pressure steady over 3 hours." : ` Pressure ${d < 0 ? "falling" : "rising"} ${Math.abs(d).toFixed(2)} inches over 3 hours${d < -0.06 ? " (the storm is getting closer or stronger)" : ""}.`); }
  return out.join("");
}

const cache = new Map<string, { at: number; feed: LocalFeed }>();
export async function localFeed(p: { lat: number; lon: number }, now = Date.now()): Promise<LocalFeed> {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = cache.get(key); if (hit && now - hit.at < 55_000) return hit.feed;
  for (const [k, v] of cache) if (now - v.at > 600_000) cache.delete(k);
  const errors: string[] = []; const items: FeedItem[] = [];
  const ll = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const pts = await getJsonNoCache<{ properties: Record<string, any> }>(`https://api.weather.gov/points/${ll}`, G);
  const office: string | null = pts.properties?.cwa ?? null;
  const alerts = getJsonNoCache<any>(`https://api.weather.gov/alerts/active?point=${ll}`, G).then((d) => items.push(...parseAlerts(d, p))).catch(() => errors.push("alerts"));
  const products = office ? Promise.all(PRODUCT_TYPES.map(async (t) => {
    try {
      const list = await getJsonNoCache<{ "@graph": { id: string; issuanceTime: string; productName?: string }[] }>(`https://api.weather.gov/products/types/${t.code}/locations/${office}`, "application/ld+json");
      for (const prod of (list["@graph"] ?? []).slice(0, t.max)) {
        if (now - Date.parse(prod.issuanceTime) > 24 * 3.6e6) continue;
        let text = "", body: string | null = null;
        try { const full = await getJsonNoCache<{ productText?: string }>(`https://api.weather.gov/products/${prod.id}`, "application/ld+json"); text = productSummary(full.productText ?? ""); body = full.productText ? productBody(full.productText) : null; } catch { /* title only */ }
        items.push({ id: `prod:${prod.id}`, time: new Date(Date.parse(prod.issuanceTime)).toISOString(), kind: "statement", title: `${t.name} from the National Weather Service (${office})`, text, full: body, url: productUrl(office, t.code), source: `National Weather Service ${office}` });
      }
    } catch { errors.push(`${t.name}`); }
  })) : Promise.resolve();
  const obs = (async () => {
    try {
      const st = await getJsonNoCache<{ features: { properties: { stationIdentifier: string; name: string } }[] }>(pts.properties.observationStations, G);
      const s = st.features?.[0]?.properties; if (!s) return null;
      const o = await getJsonNoCache<{ features: { properties: Record<string, any> }[] }>(`https://api.weather.gov/stations/${s.stationIdentifier}/observations?limit=30`, G);
      const list = (o.features ?? []).map((f) => f.properties).filter((x) => x?.timestamp);
      const latest = list[0]; if (!latest) return s.stationIdentifier;
      const t0 = Date.parse(latest.timestamp);
      const older = list.find((x) => t0 - Date.parse(x.timestamp) >= 50 * 60_000) ?? null;
      items.push({ id: `obs:${s.stationIdentifier}:${latest.timestamp}`, time: new Date(t0).toISOString(), kind: "observation",
        title: `Weather now at ${s.name}`, text: describeObs(latest, older) + obsTrends(list, t0),
        url: `https://forecast.weather.gov/data/obhistory/${s.stationIdentifier}.html`, source: "National Weather Service observation" });
      return s.stationIdentifier;
    } catch { errors.push("weather observations"); return null; }
  })();
  const lsr = office ? getJsonNoCache<any>(lsrUrl(office)).then((d) => items.push(...parseLsr(d, p, office))).catch(() => errors.push("storm reports")) : Promise.resolve();
  const [, , station] = await Promise.all([alerts, products, obs, lsr]);
  items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const feed: LocalFeed = { office, station: (station as string | null) ?? null, checked: new Date(now).toISOString(), items: items.slice(0, 30), errors };
  cache.set(key, { at: now, feed });
  return feed;
}
