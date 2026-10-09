// v0.7 radar value under a tap: the NEXRAD reflectivity (dBZ) at one point for one scan, turned into plain words.
// Source: Iowa Environmental Mesonet n0q composite WMS (the same scans as the radar layer). We ask for a tiny
// 5x5 pixel image (~2.2 km per pixel) around the point and match each pixel's color to IEM's published n0q color
// table (config/n0q-colors.json) to get dBZ back. Center pixel = "here"; the strongest of the 5x5 = "within ~3 miles".
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, USER_AGENT } from "../config.js";
import { pngRgba } from "./radarMotion.js";

type Row = [number, number, number, number, number];
let TABLE: Row[] | null = null;
const table = (): Row[] => (TABLE ??= (JSON.parse(readFileSync(path.join(ROOT, "config", "n0q-colors.json"), "utf8")).rows as Row[]));

/** dBZ for one RGBA pixel by nearest color in the n0q table; null = no echo (transparent) or not a radar color. */
export function dbzFromRgba(r: number, g: number, b: number, a: number, rows: Row[] = table()): number | null {
  if (a < 40) return null;
  let best: Row | null = null, bd = Infinity;
  for (const row of rows) { const d = (row[2] - r) ** 2 + (row[3] - g) ** 2 + (row[4] - b) ** 2; if (d < bd) { bd = d; best = row; } }
  return best && bd <= 45 ** 2 ? best[1] : null;
}

/** Plain-English meaning of a reflectivity value (rain rates are typical, not measured). */
export function dbzWords(dbz: number | null): string {
  if (dbz == null || dbz < 10) return "No rain on radar";
  if (dbz < 20) return "Very light rain or drizzle";
  if (dbz < 30) return "Light rain";
  if (dbz < 40) return "Moderate rain";
  if (dbz < 50) return "Heavy rain";
  if (dbz < 58) return "Very heavy rain, flooding possible";
  return "Intense: torrential rain, possible hail";
}

export const radarPointUrl = (lat: number, lon: number, scanIso: string) => {
  const d = 0.05; // half-width in degrees: 5 px across ~0.1 deg
  return "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=nexrad-n0q-wmst&SRS=EPSG:4326"
    + `&BBOX=${(lon - d).toFixed(4)},${(lat - d).toFixed(4)},${(lon + d).toFixed(4)},${(lat + d).toFixed(4)}&WIDTH=5&HEIGHT=5&FORMAT=image/png&TRANSPARENT=true&TIME=${scanIso.slice(0, 16)}:00Z`;
};

export interface RadarPoint { dbz: number | null; words: string; nearbyMaxDbz: number | null; nearbyWords: string; scan: string }
/** Reads the 5x5 image: center = here, max = nearby. */
export function readRadarPixels(px: Uint8Array, w: number, h: number, scan: string, rows?: Row[]): RadarPoint {
  const at = (x: number, y: number) => { const i = (y * w + x) * 4; return dbzFromRgba(px[i], px[i + 1], px[i + 2], px[i + 3], rows); };
  const here = at(Math.floor(w / 2), Math.floor(h / 2));
  let mx: number | null = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = at(x, y); if (v != null && (mx == null || v > mx)) mx = v; }
  return { dbz: here, words: dbzWords(here), nearbyMaxDbz: mx, nearbyWords: dbzWords(mx), scan };
}

const cache = new Map<string, { at: number; v: RadarPoint }>();
export async function radarPoint(lat: number, lon: number, scanIso: string): Promise<RadarPoint> {
  const url = radarPointUrl(lat, lon, scanIso), hit = cache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  const r = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const { w, h, px } = pngRgba(buf);
  const v = readRadarPixels(px, w, h, scanIso);
  cache.set(url, { at: Date.now(), v });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return v;
}

/** Which real scan to read for slider time t: the latest scan when live, else the 5-minute scan at or before t; null for future times. */
export function scanFor(t: number, now: number, latestScan: string | null): string | null {
  if (t > now + 2 * 60_000) return null;
  const latest = latestScan ? Date.parse(latestScan) : NaN;
  if (Number.isFinite(latest) && t >= latest) return new Date(latest).toISOString();
  return new Date(Math.floor(t / 300_000) * 300_000).toISOString();
}
