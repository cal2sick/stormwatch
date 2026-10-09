// Per-advisory NHC GIS: cone / forecast track / watches-warnings (shapefile zip), best track (zip),
// 34-kt time-of-arrival isochrones (KMZ), and the verbatim public advisory text.
// Downloaded only when the advisory number changes; cached per advisory on disk.
import shp from "shpjs";
import { unzip } from "but-unzip";
import { inflateRawSync } from "node:zlib";
import { getBytes, getText } from "../http.js";
import { readCache, writeCache } from "../cache.js";
import type { StormGis } from "../types.js";
import type { RawStorm } from "./nhc.js";

type FC = GeoJSON.FeatureCollection;
type ShpOut = (FC & { fileName?: string }) | (FC & { fileName?: string })[];

async function parseZip(bytes: Uint8Array): Promise<(FC & { fileName?: string })[]> {
  const out = (await shp(Buffer.from(bytes) as unknown as ArrayBuffer)) as ShpOut;
  return Array.isArray(out) ? out : [out];
}
const pick = (fcs: (FC & { fileName?: string })[], suffix: string) => fcs.find((f) => f.fileName?.toLowerCase().endsWith(suffix)) ?? null;

/** "09/1200" (DD/HHMM UTC) -> ISO, using the advisory issuance for year/month. */
export function validTimeToIso(v: string, issuance: string): string | null {
  const m = /^(\d{2})\/(\d{2})(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const iss = new Date(issuance);
  let y = iss.getUTCFullYear(), mo = iss.getUTCMonth();
  const day = Number(m[1]);
  if (day < iss.getUTCDate() - 15) { mo += 1; if (mo > 11) { mo = 0; y += 1; } }
  return new Date(Date.UTC(y, mo, day, Number(m[2]), Number(m[3]))).toISOString();
}

const TZ: Record<string, number> = { UTC: 0, GMT: 0, AST: -4, ADT: -3, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, HST: -10 };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri 2 pm" in zone tz, on/after the advisory issuance -> ISO. */
export function toaLabelToIso(label: string, tz: string, issuance: string): string | null {
  const m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\s*(am|pm)$/i.exec(label.trim());
  if (!m) return null;
  const off = TZ[tz.toUpperCase()] ?? 0;
  let h = Number(m[2]) % 12; if (m[3].toLowerCase() === "pm") h += 12;
  const wd = DAYS.findIndex((d) => d.toLowerCase() === m[1].toLowerCase());
  const issMs = Date.parse(issuance);
  const local = new Date(issMs + off * 3_600_000);
  for (let d = 0; d < 8; d++) {
    const c = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d, h) - off * 3_600_000);
    if (c.getTime() + off * 3_600_000 >= 0 && new Date(c.getTime() + off * 3_600_000).getUTCDay() === wd && c.getTime() >= issMs - 6 * 3_600_000) return c.toISOString();
  }
  return null;
}

/** Parse NHC TOA KML: LineString isochrones with "<td>Fri 2 pm</td>" descriptions. */
export function parseToaKml(kml: string, issuance: string): FC {
  const tz = /<Data name="timezone">\s*<value>([^<]+)<\/value>/.exec(kml)?.[1] ?? "UTC";
  const features: GeoJSON.Feature[] = [];
  const re = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(kml))) {
    const body = m[1];
    const label = /<td>([^<]+)<\/td>/.exec(body)?.[1]?.trim();
    const coords = /<LineString>\s*<coordinates>([\s\S]*?)<\/coordinates>/.exec(body)?.[1];
    if (!label || !coords) continue;
    const time = toaLabelToIso(label, tz, issuance);
    const line = coords.trim().split(/\s+/).map((c) => c.split(",").slice(0, 2).map(Number)).filter((c) => c.length === 2 && c.every(isFinite));
    if (!time || line.length < 2) continue;
    features.push({ type: "Feature", properties: { time, label: `${label} ${tz}` }, geometry: { type: "LineString", coordinates: line } });
  }
  features.sort((a, b) => Date.parse(a.properties!.time) - Date.parse(b.properties!.time));
  return { type: "FeatureCollection", features };
}

async function kmzToKml(bytes: Uint8Array): Promise<string> {
  for (const item of unzip(bytes, (raw) => inflateRawSync(raw))) {
    if (item.filename.toLowerCase().endsWith(".kml")) return new TextDecoder().decode(await item.read());
  }
  throw new Error("KMZ has no KML");
}

/** Verbatim text of the public advisory: the <pre> block, tags stripped, entities decoded. */
export function extractAdvisoryText(html: string): string | null {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html)?.[1];
  if (!pre) return null;
  return pre.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

const WW_LABEL: Record<string, string> = { HWR: "Hurricane Warning", HWA: "Hurricane Watch", TWR: "Tropical Storm Warning", TWA: "Tropical Storm Watch" };

export async function buildStormGis(s: RawStorm): Promise<StormGis & { advisoryText: string | null }> {
  const adv = s.trackCone?.advNum ?? s.publicAdvisory?.advNum ?? "?";
  const issuance = s.trackCone?.issuance ?? s.publicAdvisory?.issuance ?? null;
  const key = `gis-${s.id}-${adv}`;
  const cached = readCache<StormGis & { advisoryText: string | null }>(key);
  if (cached) return cached;

  const gis: StormGis & { advisoryText: string | null } = {
    stormId: s.id, advisoryNumber: adv, issuance, cone: null, forecastLine: null, forecastPoints: null,
    watchesWarnings: null, bestTrack: null, toaEarliest: null, toaMostLikely: null, advisoryText: null,
  };
  const errors: string[] = [];

  if (s.trackCone?.zipFile) {
    try {
      const fcs = await parseZip(await getBytes(s.trackCone.zipFile));
      gis.cone = pick(fcs, "_pgn");
      gis.forecastLine = pick(fcs, "_lin");
      const pts = pick(fcs, "_pts");
      if (pts && issuance) {
        gis.forecastPoints = {
          type: "FeatureCollection",
          features: pts.features.map((f) => {
            const p = f.properties as Record<string, any>;
            return { ...f, properties: {
              time: validTimeToIso(String(p.VALIDTIME ?? ""), issuance), tau: p.TAU, label: p.DATELBL, flLabel: p.FLDATELBL,
              maxWindKt: p.MAXWIND, gustKt: p.GUST, mslp: p.MSLP, dvlbl: p.DVLBL, type: p.TCDVLP,
            } };
          }),
        };
      }
      const ww = pick(fcs, "_wwlin");
      if (ww) ww.features.forEach((f) => { const t = String((f.properties as any)?.TCWW ?? ""); f.properties = { type: t, label: WW_LABEL[t] ?? t }; });
      gis.watchesWarnings = ww;
    } catch (e) { errors.push(`cone: ${(e as Error).message}`); }
  }
  if (s.bestTrackGIS?.zipFile) {
    try {
      const fcs = await parseZip(await getBytes(s.bestTrackGIS.zipFile));
      const lin = pick(fcs, "_lin"), pts = pick(fcs, "_pts");
      gis.bestTrack = { type: "FeatureCollection", features: [
        ...(lin?.features ?? []).map((f) => ({ ...f, properties: { kind: "line", stormType: (f.properties as any)?.STORMTYPE } })),
        ...(pts?.features ?? []).map((f) => {
          const p = f.properties as any;
          const dtg = String(p.DTG ?? "");
          const time = dtg.length === 10 ? new Date(Date.UTC(+dtg.slice(0, 4), +dtg.slice(4, 6) - 1, +dtg.slice(6, 8), +dtg.slice(8, 10))).toISOString() : null;
          return { ...f, properties: { kind: "point", time, intensityKt: p.INTENSITY, stormType: p.STORMTYPE } };
        }),
      ] };
    } catch (e) { errors.push(`best track: ${(e as Error).message}`); }
  }
  for (const [k, src] of [["toaEarliest", s.earliestArrivalTimeTSWindsGIS], ["toaMostLikely", s.mostLikelyTimeTSWindsGIS]] as const) {
    if (!src?.kmzFile || !(src.issuance ?? issuance)) continue;
    try { gis[k] = parseToaKml(await kmzToKml(await getBytes(src.kmzFile)), (src.issuance ?? issuance)!); }
    catch (e) { errors.push(`${k}: ${(e as Error).message}`); }
  }
  if (s.publicAdvisory?.url) {
    try { gis.advisoryText = extractAdvisoryText(await getText(s.publicAdvisory.url)); }
    catch (e) { errors.push(`advisory text: ${(e as Error).message}`); }
  }
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { partial: gis });
  writeCache(key, gis);
  return gis;
}
