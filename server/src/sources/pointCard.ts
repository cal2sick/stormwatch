// v0.6.1 tap-on-map area card: everything for ONE exact point, fetched for that point only.
// Root-cause fix: before 0.6.1 there was no point lookup at all. A click on the map hit the hazard-polygon popup,
// and because one big polygon (e.g. a Tornado Watch) covers the whole region, every click showed the same card.
// Now: NWS /points -> gridpoint data (wind, gusts, rain chance, rain amount at the chosen time),
// NWS alerts?point= filtered to the chosen time, OpenStreetMap reverse geocode, nearest outages.
// Base data is cached per point rounded to 0.01 deg (~0.7 mi) for 5 minutes; the time filter runs per request.
import { USER_AGENT } from "../config.js";
import { nearbyOutages, type NearbyOutages } from "./place.js";

export type Fetcher = (url: string, accept?: string) => Promise<any>;
const defaultFetch: Fetcher = async (url, accept = "application/geo+json") => {
  const r = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export interface Sourced<T> { value: T | null; source: string; time: string | null; note?: string }
export interface PointCard {
  lat: number; lon: number; key: string; at: string; fetched: string;
  place: Sourced<string>;
  wind: Sourced<{ mph: number; dir: string | null }>; gust: Sourced<number>; rainChance: Sourced<number>; rainIn: Sourced<number>;
  alerts: Sourced<{ event: string; headline: string | null; severity: string | null; onset: string | null; ends: string | null; sender: string | null }[]>;
  outages: Sourced<{ nearestMi: number | null; customersNearby: number; radiusMi: number; county: string | null; countyOut: number | null; coverage: string }>;
  radar: Sourced<string>;
}

/** Parse an NWS gridpoint validTime "2026-10-09T22:00:00+00:00/PT3H" into [start, end) ms. */
export function parseValidTime(v: string): [number, number] | null {
  const [s, d] = String(v).split("/"); const t0 = Date.parse(s); if (!isFinite(t0)) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d ?? "PT1H");
  const ms = m ? (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3.6e6 + Number(m[3] ?? 0) * 60_000 : 3.6e6;
  return [t0, t0 + (ms || 3.6e6)];
}
/** The gridpoint series value in effect at time t (null if t is outside the series). */
export function gridValueAt(series: { uom?: string; values?: { validTime: string; value: number | null }[] } | undefined, t: number): { v: number; t0: number; t1: number } | null {
  for (const x of series?.values ?? []) { const r = parseValidTime(x.validTime); if (r && t >= r[0] && t < r[1] && x.value != null) return { v: x.value, t0: r[0], t1: r[1] }; }
  return null;
}
export const toMph = (v: number, uom = "") => (/km_h/.test(uom) ? v * 0.621371 : /m_s/.test(uom) ? v * 2.23694 : /kt/.test(uom) ? v * 1.15078 : v);
const compass16 = (d: number) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
/** Alerts in effect at time t: onset (or effective/sent) <= t < ends (or expires). */
export function alertsAt(features: { properties: Record<string, any> }[], t: number) {
  return features.map((f) => f.properties).filter((q) => {
    const start = Date.parse(q.onset ?? q.effective ?? q.sent ?? ""), end = Date.parse(q.ends ?? q.expires ?? "");
    return (!isFinite(start) || start <= t) && (!isFinite(end) || t < end);
  }).map((q) => ({ event: String(q.event ?? "Alert"), headline: q.headline ?? null, severity: q.severity ?? null, onset: q.onset ?? q.effective ?? null, ends: q.ends ?? q.expires ?? null, sender: q.senderName ?? null }));
}

interface Base { fetched: number; pts: any | null; grid: any | null; alerts: any | null; name: any | null; outages: NearbyOutages | null; errors: Record<string, string> }
const cache = new Map<string, Base>();
export const pointKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;
export function clearPointCache() { cache.clear(); }

async function loadBase(lat: number, lon: number, f: Fetcher, outagesFn: (p: { lat: number; lon: number }) => Promise<NearbyOutages>): Promise<Base> {
  const key = pointKey(lat, lon), hit = cache.get(key);
  if (hit && Date.now() - hit.fetched < 5 * 60_000) return hit;
  const errors: Record<string, string> = {};
  const q = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const safe = <T>(k: string, p: Promise<T>) => p.catch((e) => { errors[k] = String(e?.message ?? e); return null; });
  const [pts, alerts, name, outages] = await Promise.all([
    safe("nws", f(`https://api.weather.gov/points/${q}`)),
    safe("alerts", f(`https://api.weather.gov/alerts/active?point=${q}`)),
    safe("place", f(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, "application/json")),
    safe("outages", outagesFn({ lat, lon })),
  ]);
  const grid = pts?.properties?.forecastGridData ? await safe("grid", f(pts.properties.forecastGridData)) : null;
  const b: Base = { fetched: Date.now(), pts, grid, alerts, name, outages, errors };
  cache.set(key, b);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return b;
}

const placeName = (n: any): string | null => {
  const a = n?.address ?? {};
  const local = a.suburb ?? a.neighbourhood ?? a.hamlet ?? a.village ?? a.town ?? a.city ?? a.county ?? null;
  const city = a.city ?? a.town ?? a.village ?? null;
  const parts = [local, city && city !== local ? city : null, a.state].filter(Boolean);
  return parts.length ? parts.join(", ") : (n?.display_name ?? null);
};

export async function pointCard(lat: number, lon: number, t: number, f: Fetcher = defaultFetch, outagesFn = nearbyOutages): Promise<PointCard> {
  const b = await loadBase(lat, lon, f, outagesFn);
  const g = b.grid?.properties, upd = g?.updateTime ?? null, NWS = "NWS gridpoint forecast";
  const unavailable = <T>(source: string, note: string): Sourced<T> => ({ value: null, source, time: null, note });
  const tooFar = g && !gridValueAt(g.windSpeed, t) ? "No NWS forecast covers this time here." : undefined;
  const ws = gridValueAt(g?.windSpeed, t), wd = gridValueAt(g?.windDirection, t), gu = gridValueAt(g?.windGust, t), pop = gridValueAt(g?.probabilityOfPrecipitation, t), qpf = gridValueAt(g?.quantitativePrecipitation, t);
  const nwsNote = b.errors.nws ? "NWS has no forecast for this point (offshore or outside the US)." : b.errors.grid ? "NWS gridpoint forecast did not answer." : tooFar;
  const card: PointCard = {
    lat, lon, key: pointKey(lat, lon), at: new Date(t).toISOString(), fetched: new Date(b.fetched).toISOString(),
    place: b.name && placeName(b.name) ? { value: placeName(b.name), source: "OpenStreetMap Nominatim (reverse geocode)", time: new Date(b.fetched).toISOString() } : unavailable("OpenStreetMap Nominatim", "No place name for this spot."),
    wind: ws ? { value: { mph: Math.round(toMph(ws.v, g.windSpeed.uom)), dir: wd ? compass16(wd.v) : null }, source: NWS, time: upd } : unavailable(NWS, nwsNote ?? "No wind forecast for this time."),
    gust: gu ? { value: Math.round(toMph(gu.v, g.windGust.uom)), source: NWS, time: upd } : unavailable(NWS, nwsNote ?? "No gust forecast for this time."),
    rainChance: pop ? { value: Math.round(pop.v), source: NWS, time: upd } : unavailable(NWS, nwsNote ?? "No rain chance for this time."),
    rainIn: qpf ? { value: Math.round(qpf.v / 25.4 * 100) / 100, source: `${NWS} (rain in the ${Math.round((qpf.t1 - qpf.t0) / 3.6e6)} h block)`, time: upd } : unavailable(NWS, nwsNote ?? "No rain amount for this time."),
    alerts: b.alerts ? { value: alertsAt(b.alerts.features ?? [], t), source: "NWS alerts for this point", time: b.alerts.updated ?? new Date(b.fetched).toISOString() } : unavailable("NWS alerts", "NWS alerts did not answer."),
    outages: b.outages ? { value: { nearestMi: b.outages.outages[0]?.distanceMi ?? null, customersNearby: b.outages.totalCustomers, radiusMi: b.outages.radiusMi, county: b.outages.county?.name ?? null,
      countyOut: b.outages.county ? b.outages.county.rows.reduce((s, r) => s + r.customers, 0) : null, coverage: b.outages.coverage },
      source: [...b.outages.feeds.filter((x) => x.status === "ok").map((x) => x.name), b.outages.county?.source].filter(Boolean).join(" + ") || "utility feeds", time: b.outages.checked } : unavailable("utility outage feeds", "Outage feeds did not answer."),
    radar: unavailable("NEXRAD (IEM)", "Radar value under the tap is not available yet; see the radar layer on the map."),
  };
  return card;
}
