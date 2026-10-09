// v0.7 "Rain so far": observed rain totals at one point from NOAA MRMS (multi-radar, gauge-corrected), via the
// Iowa Environmental Mesonet (free, keyless). 1 hour, 24 hours and 72 hours (IEM has no 6-hour MRMS product).
// We read a 5x5-pixel WMS image around the point and map the center pixel's color back to millimeters with IEM's
// published MRMS precip color table (config/mrms-precip-colors.json). Valid times come from IEM's metadata JSON.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, USER_AGENT } from "../config.js";
import { pngRgba } from "./radarMotion.js";

type Row = [number, number, number, number, number];
let TABLE: Row[] | null = null;
const table = (): Row[] => (TABLE ??= (JSON.parse(readFileSync(path.join(ROOT, "config", "mrms-precip-colors.json"), "utf8")).rows as Row[]));

export const PERIODS = [["p1h", 1], ["p24h", 24], ["p72h", 72]] as const;
export type Period = (typeof PERIODS)[number][0];
/** mm for one pixel: transparent = 0, else the nearest table color (first = lowest when colors repeat). null = not a table color. */
export function mmFromRgba(r: number, g: number, b: number, a: number, rows: Row[] = table()): number | null {
  if (a < 40) return 0;
  let best: Row | null = null, bd = Infinity;
  for (const row of rows) { const d = (row[2] - r) ** 2 + (row[3] - g) ** 2 + (row[4] - b) ** 2; if (d < bd) { bd = d; best = row; } }
  return best && bd <= 30 ** 2 ? best[1] : null;
}
export const mmToIn = (mm: number) => Math.round(mm / 25.4 * 100) / 100;
export const rainUrl = (layer: Period, lat: number, lon: number) => { const d = 0.05;
  return `https://mesonet.agron.iastate.edu/cgi-bin/wms/us/mrms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=mrms_${layer}&SRS=EPSG:4326`
    + `&BBOX=${(lon - d).toFixed(4)},${(lat - d).toFixed(4)},${(lon + d).toFixed(4)},${(lat + d).toFixed(4)}&WIDTH=5&HEIGHT=5&FORMAT=image/png&TRANSPARENT=true`; };
export const metaUrl = (layer: Period) => `https://mesonet.agron.iastate.edu/data/gis/images/4326/mrms/${layer}.json`;

export interface RainTotal { inches: number | null; start: string | null; end: string | null }
export type RainTotals = Record<Period, RainTotal> & { source: string; checked: string };

const get = async (url: string) => { const r = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(12_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
const cache = new Map<string, { at: number; v: RainTotals }>();
export async function rainTotals(lat: number, lon: number): Promise<RainTotals> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  const one = async (p: Period): Promise<RainTotal> => {
    const [img, meta] = await Promise.all([get(rainUrl(p, lat, lon)).then(async (r) => Buffer.from(await r.arrayBuffer())), get(metaUrl(p)).then((r) => r.json()).catch(() => null)]);
    const { w, h, px } = pngRgba(img), i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
    const mm = mmFromRgba(px[i], px[i + 1], px[i + 2], px[i + 3]);
    return { inches: mm == null ? null : mmToIn(mm), start: meta?.meta?.start_valid ?? null, end: meta?.meta?.end_valid ?? null };
  };
  const [p1h, p24h, p72h] = await Promise.all(PERIODS.map(([p]) => one(p).catch(() => ({ inches: null, start: null, end: null }))));
  const v: RainTotals = { p1h, p24h, p72h, source: "NOAA MRMS radar + gauge rain totals via Iowa Environmental Mesonet", checked: new Date().toISOString() };
  cache.set(key, { at: Date.now(), v }); if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return v;
}
