// "Latest for <place>": a newest-first list of official updates near one point.
// Sources (all free, keyless): NWS alerts for the point, the local NWS office's Hurricane Local Statement (HLS),
// short-term forecast (NOW) and special weather statements (SPS), the nearest NWS observation station, and
// NWS local storm reports (LSR) via Iowa Environmental Mesonet. No social media.
// PRIVACY: the route runs with logLevel "warn"; the point is only kept in a 2-minute in-memory cache.
import { getJsonNoCache } from "./place.js";
import { distanceMi } from "../geo.js";

export interface FeedItem { id: string; time: string; kind: "alert" | "statement" | "observation" | "report"; title: string; text: string; url: string | null; source: string }
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
      title: `Storm report: ${String(q.typetext ?? "report").toLowerCase()}${mag}, ${q.city ?? ""}${q.st ? ", " + q.st : ""} (${Math.round(d)} miles away)`,
      text: q.remark ?? "", url: q.product_id ? `https://mesonet.agron.iastate.edu/p.php?pid=${encodeURIComponent(q.product_id)}` : null,
      source: `NWS local storm report (${q.source ?? "report"}) via Iowa Environmental Mesonet`, d });
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

const cache = new Map<string, { at: number; feed: LocalFeed }>();
export async function localFeed(p: { lat: number; lon: number }, now = Date.now()): Promise<LocalFeed> {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = cache.get(key); if (hit && now - hit.at < 120_000) return hit.feed;
  for (const [k, v] of cache) if (now - v.at > 600_000) cache.delete(k);
  const errors: string[] = []; const items: FeedItem[] = [];
  const ll = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const pts = await getJsonNoCache<{ properties: Record<string, any> }>(`https://api.weather.gov/points/${ll}`, G);
  const office: string | null = pts.properties?.cwa ?? null;
  const alerts = getJsonNoCache<any>(`https://api.weather.gov/alerts/active?point=${ll}`, G).then((d) => items.push(...parseAlerts(d, p))).catch(() => errors.push("NWS alerts"));
  const products = office ? Promise.all(PRODUCT_TYPES.map(async (t) => {
    try {
      const list = await getJsonNoCache<{ "@graph": { id: string; issuanceTime: string; productName?: string }[] }>(`https://api.weather.gov/products/types/${t.code}/locations/${office}`, "application/ld+json");
      for (const prod of (list["@graph"] ?? []).slice(0, t.max)) {
        if (now - Date.parse(prod.issuanceTime) > 24 * 3.6e6) continue;
        let text = "";
        try { const full = await getJsonNoCache<{ productText?: string }>(`https://api.weather.gov/products/${prod.id}`, "application/ld+json"); text = productHeadline(full.productText ?? ""); } catch { /* title only */ }
        items.push({ id: `prod:${prod.id}`, time: new Date(Date.parse(prod.issuanceTime)).toISOString(), kind: "statement", title: `${t.name} from NWS ${office}`, text, url: productUrl(office, t.code), source: `National Weather Service ${office}` });
      }
    } catch { errors.push(`NWS ${t.code}`); }
  })) : Promise.resolve();
  const obs = (async () => {
    try {
      const st = await getJsonNoCache<{ features: { properties: { stationIdentifier: string; name: string } }[] }>(pts.properties.observationStations, G);
      const s = st.features?.[0]?.properties; if (!s) return null;
      const o = await getJsonNoCache<{ features: { properties: Record<string, any> }[] }>(`https://api.weather.gov/stations/${s.stationIdentifier}/observations?limit=8`, G);
      const list = (o.features ?? []).map((f) => f.properties).filter((x) => x?.timestamp);
      const latest = list[0]; if (!latest) return s.stationIdentifier;
      const t0 = Date.parse(latest.timestamp);
      const older = list.find((x) => t0 - Date.parse(x.timestamp) >= 50 * 60_000) ?? null;
      items.push({ id: `obs:${s.stationIdentifier}:${latest.timestamp}`, time: new Date(t0).toISOString(), kind: "observation",
        title: `Observed at ${s.name} (${s.stationIdentifier})`, text: describeObs(latest, older),
        url: `https://forecast.weather.gov/data/obhistory/${s.stationIdentifier}.html`, source: "NWS observation" });
      return s.stationIdentifier;
    } catch { errors.push("NWS observation"); return null; }
  })();
  const lsr = office ? getJsonNoCache<any>(lsrUrl(office)).then((d) => items.push(...parseLsr(d, p, office))).catch(() => errors.push("storm reports")) : Promise.resolve();
  const [, , station] = await Promise.all([alerts, products, obs, lsr]);
  items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const feed: LocalFeed = { office, station: (station as string | null) ?? null, checked: new Date(now).toISOString(), items: items.slice(0, 30), errors };
  cache.set(key, { at: now, feed });
  return feed;
}
