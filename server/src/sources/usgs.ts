import { getJson } from "../http.js";
import type { Home } from "../config.js";
import type { Gauge } from "../types.js";

/** Active gauges in a box around your location (USGS_BOX_DEG, default 0.6 degrees each way); gage height (00065), last 6 h. */
export function usgsUrl(home: Home, deg = Number(process.env.USGS_BOX_DEG || 0.6)): string {
  const f = (x: number) => x.toFixed(4);
  const box = [f(home.lon - deg), f(home.lat - deg), f(home.lon + deg), f(home.lat + deg)].join(",");
  return `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${box}&parameterCd=00065&siteStatus=active&period=PT6H`;
}

export async function fetchUsgs(home: Home): Promise<{ gauges: Gauge[]; sourceTime: string | null }> {
  const r = await getJson<any>(usgsUrl(home));
  const gauges: Gauge[] = [];
  for (const ts of r?.value?.timeSeries ?? []) {
    const info = ts.sourceInfo;
    const noData = Number(ts.variable?.noDataValue ?? -999999);
    const vals = (ts.values?.[0]?.value ?? [])
      .map((v: any) => ({ t: new Date(v.dateTime).toISOString(), v: Number(v.value) }))
      .filter((v: { v: number }) => isFinite(v.v) && v.v !== noData);
    const last = vals.at(-1);
    let change3h: number | null = null;
    if (last) {
      const target = Date.parse(last.t) - 3 * 3_600_000;
      const prior = [...vals].reverse().find((v: { t: string }) => Date.parse(v.t) <= target + 10 * 60_000);
      if (prior) change3h = Math.round((last.v - prior.v) * 100) / 100;
    }
    const step = Math.max(1, Math.ceil(vals.length / 24));
    gauges.push({
      id: info.siteCode?.[0]?.value ?? ts.name,
      name: info.siteName,
      lat: info.geoLocation.geogLocation.latitude,
      lon: info.geoLocation.geogLocation.longitude,
      stageFt: last?.v ?? null,
      time: last?.t ?? null,
      change3hFt: change3h,
      trend: change3h == null ? "unknown" : change3h > 0.1 ? "rising" : change3h < -0.1 ? "falling" : "steady",
      series: vals.filter((_: unknown, i: number) => i % step === 0 || i === vals.length - 1),
    });
  }
  gauges.sort((a, b) => (b.change3hFt ?? -99) - (a.change3hFt ?? -99));
  const sourceTime = gauges.map((g) => g.time).filter(Boolean).sort().pop() ?? null;
  return { gauges, sourceTime };
}
