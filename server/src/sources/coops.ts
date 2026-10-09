// NOAA CO-OPS water levels (Tides and Currents), keyless: https://api.tidesandcurrents.noaa.gov/api/prod/
// Observed water level vs the predicted (astronomical) tide, both on the MHHW datum (the normal high-tide line).
// "Above predicted" is a surge-like readout; it is an estimate, not the official storm surge forecast.
import { getJson } from "../http.js";
import type { TideStation } from "../types.js";

const BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
export const coopsUrl = (id: string, product: "water_level" | "predictions") =>
  `${BASE}?station=${id}&product=${product}&range=6&datum=MHHW&units=english&time_zone=gmt&format=json&application=stormwatch${product === "predictions" ? "&interval=6" : ""}`;
export const COOPS_URL = BASE;

type Row = { t: string; v: string };
const iso = (t: string) => new Date(t.replace(" ", "T") + ":00Z").toISOString();

/** Pure: combine observed + predicted series into one station readout. */
export function tideReadout(id: string, meta: { name?: string; lat?: string; lon?: string } | undefined, obs: Row[], pred: Row[]): TideStation | null {
  const o = obs.filter((r) => r.v !== "" && isFinite(Number(r.v)));
  if (!o.length) return null;
  const last = o[o.length - 1];
  const tl = Date.parse(iso(last.t));
  const p = pred.map((r) => ({ t: Date.parse(iso(r.t)), v: Number(r.v) })).filter((r) => isFinite(r.v));
  const near = p.reduce<{ t: number; v: number } | null>((b, r) => (!b || Math.abs(r.t - tl) < Math.abs(b.t - tl) ? r : b), null);
  const o3 = o.find((r) => Date.parse(iso(r.t)) >= tl - 3 * 3_600_000);
  const levelFt = Number(last.v);
  return {
    id, name: meta?.name ?? id, lat: Number(meta?.lat), lon: Number(meta?.lon), time: new Date(tl).toISOString(),
    levelFtMhhw: Math.round(levelFt * 100) / 100,
    predictedFtMhhw: near && Math.abs(near.t - tl) <= 15 * 60_000 ? Math.round(near.v * 100) / 100 : null,
    aboveForecastFt: near && Math.abs(near.t - tl) <= 15 * 60_000 ? Math.round((levelFt - near.v) * 100) / 100 : null,
    change3hFt: o3 ? Math.round((levelFt - Number(o3.v)) * 100) / 100 : null,
    url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${id}`,
  };
}

export async function fetchCoops(ids: string[]): Promise<{ tides: TideStation[]; sourceTime: string | null }> {
  const out: TideStation[] = [];
  const errs: string[] = [];
  for (const id of ids) {
    try {
      const [o, p] = await Promise.all([
        getJson<{ metadata?: { name: string; lat: string; lon: string }; data?: Row[] }>(coopsUrl(id, "water_level")),
        getJson<{ predictions?: Row[] }>(coopsUrl(id, "predictions")).catch(() => ({ predictions: [] as Row[] })),
      ]);
      const r = tideReadout(id, o.metadata, o.data ?? [], p.predictions ?? []);
      if (r) out.push(r);
    } catch (e) { errs.push(`${id}: ${(e as Error).message}`); }
  }
  if (!out.length && errs.length) throw new Error(errs.join("; "));
  return { tides: out, sourceTime: out.map((x) => x.time).sort().pop() ?? null };
}
