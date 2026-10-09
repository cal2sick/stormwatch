import { getJson } from "../http.js";
import { readCache, writeCache } from "../cache.js";
import type { Home } from "../config.js";
import type { Forecast, HourlyPoint, NwsAlert } from "../types.js";

export const nwsAlertsUrl = (h: Home) =>
  `https://api.weather.gov/alerts/active?point=${h.lat.toFixed(4)},${h.lon.toFixed(4)}`;
export const nwsPointsUrl = (h: Home) => `https://api.weather.gov/points/${h.lat.toFixed(4)},${h.lon.toFixed(4)}`;

interface Feature { id: string; properties: Record<string, any> }

/** Active NWS alerts for the home point. Text is kept verbatim. */
export async function fetchNwsAlerts(home: Home): Promise<{ alerts: NwsAlert[]; sourceTime: string | null }> {
  const raw = await getJson<{ features: Feature[]; updated?: string }>(nwsAlertsUrl(home), "application/geo+json");
  const alerts = (raw.features ?? []).map((f): NwsAlert => {
    const p = f.properties;
    return {
      id: f.id, event: p.event, severity: p.severity, urgency: p.urgency, certainty: p.certainty,
      headline: p.headline ?? null, description: p.description ?? "", instruction: p.instruction ?? null,
      onset: p.onset ?? null, expires: p.expires ?? null, ends: p.ends ?? null, sent: p.sent ?? null,
      senderName: p.senderName ?? null,
    };
  });
  return { alerts, sourceTime: raw.updated ?? null };
}

interface Points { lat: number; lon: number; office: string; forecastHourly: string; forecastGridData: string }

/** NWS points lookup, cached to data/points.json and re-run only if home changes. */
export async function getPoints(home: Home): Promise<Points> {
  const c = readCache<Points>("points");
  if (c && c.lat === home.lat && c.lon === home.lon) return c;
  const r = await getJson<{ properties: Record<string, any> }>(nwsPointsUrl(home), "application/geo+json");
  const p: Points = { lat: home.lat, lon: home.lon, office: r.properties.gridId, forecastHourly: r.properties.forecastHourly, forecastGridData: r.properties.forecastGridData };
  writeCache("points", p);
  return p;
}

/** "PT2H" / "P1DT3H" -> hours */
function durHours(d: string): number {
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(d);
  return m ? Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60 : 1;
}
type GridSeries = { uom?: string; values: { validTime: string; value: number | null }[] };
/** Expand a gridpoint series into [startMs, endMs, value] spans. */
function spans(s: GridSeries | undefined) {
  return (s?.values ?? []).map((v) => {
    const [start, dur] = v.validTime.split("/");
    const t0 = Date.parse(start);
    return { t0, t1: t0 + durHours(dur) * 3_600_000, v: v.value };
  });
}
const toMph = (v: number | null, uom?: string) => v == null ? null : /km_h/.test(uom ?? "") ? v * 0.621371 : /m_s/.test(uom ?? "") ? v * 2.23694 : /kt/.test(uom ?? "") ? v * 1.15078 : v;
const parseMph = (s: string | undefined) => { const n = (s ?? "").match(/\d+/g); return n ? Math.max(...n.map(Number)) : null; };

export async function fetchForecast(home: Home): Promise<{ forecast: Forecast; sourceTime: string | null }> {
  const pts = await getPoints(home);
  const hourly = await getJson<{ properties: { updateTime?: string; periods: any[] } }>(pts.forecastHourly, "application/geo+json");
  let grid: Record<string, any> | null = null;
  try { grid = (await getJson<{ properties: Record<string, any> }>(pts.forecastGridData, "application/geo+json")).properties; } catch { grid = null; }
  const gust = spans(grid?.windGust);
  const gustUom = grid?.windGust?.uom as string | undefined;
  const now = Date.now();
  const periods: HourlyPoint[] = hourly.properties.periods
    .filter((p) => Date.parse(p.endTime) > now).slice(0, 48)
    .map((p) => {
      const t = Date.parse(p.startTime);
      const g = gust.find((s) => t >= s.t0 && t < s.t1);
      return {
        time: new Date(t).toISOString(), tempF: p.temperature ?? null, windMph: parseMph(p.windSpeed),
        gustMph: g?.v != null ? Math.round(toMph(g.v, gustUom)!) : null, windDir: p.windDirection ?? null,
        pop: p.probabilityOfPrecipitation?.value ?? null, shortForecast: p.shortForecast ?? "",
      };
    });
  // QPF: sum each span's share that falls inside the window (mm -> in).
  const qpf = spans(grid?.quantitativePrecipitation);
  const qpfIn = (hours: number) => {
    if (!grid) return null;
    const end = now + hours * 3_600_000;
    let mm = 0;
    for (const s of qpf) {
      if (s.v == null || s.t1 <= now || s.t0 >= end) continue;
      const overlap = Math.min(s.t1, end) - Math.max(s.t0, now);
      mm += s.v * (overlap / (s.t1 - s.t0));
    }
    return Math.round((mm / 25.4) * 100) / 100;
  };
  const gusts = periods.map((p) => p.gustMph).filter((g): g is number => g != null);
  return {
    forecast: {
      office: pts.office, hourly: periods, qpf24In: qpfIn(24), qpf48In: qpfIn(48),
      maxGust48Mph: gusts.length ? Math.max(...gusts) : null, updateTime: hourly.properties.updateTime ?? grid?.updateTime ?? null,
    },
    sourceTime: hourly.properties.updateTime ?? null,
  };
}
