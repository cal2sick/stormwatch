import { getJson } from "../http.js";
import type { RadarFrames } from "../types.js";

// Default radar: Iowa Environmental Mesonet NEXRAD base reflectivity composite (n0q), 5-minute scans, archived,
// so past slider times get the matching frame. Free and keyless: https://mesonet.agron.iastate.edu/ogc/
export const IEM_TILE_HOST = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-";
export const iemListUrl = (start: Date, end: Date) =>
  `https://mesonet.agron.iastate.edu/json/radar.py?operation=list&product=N0Q&radar=USCOMP&start=${start.toISOString().slice(0, 16)}Z&end=${end.toISOString().slice(0, 16)}Z`;
export const RADAR_URL = "https://mesonet.agron.iastate.edu/json/radar.py";
// Fallback only if IEM is down.
export const RAINVIEWER_URL = "https://api.rainviewer.com/public/weather-maps.json";

/** "2026-10-09T18:05Z" -> "202610091805" (the IEM tile stamp). */
export const iemStamp = (iso: string) => iso.replace(/\D/g, "").slice(0, 12);

/** Pick ~10-minute frames from the IEM scan list (newest kept), at most `max`. */
export function pickIemFrames(scans: { ts: string }[], max = 13): { time: string; path: string }[] {
  const out: { time: string; path: string }[] = [];
  for (let i = scans.length - 1; i >= 0 && out.length < max; i -= 2) {
    const t = Date.parse(scans[i].ts.replace(/Z?$/, "Z"));
    if (isFinite(t)) out.unshift({ time: new Date(t).toISOString(), path: iemStamp(new Date(t).toISOString()) });
  }
  return out;
}

/** Scans whose tiles should exist: drop any newer than `minAgeMs` (the IEM list can run ahead of the tile cache). */
export function usableScans(scans: { ts: string }[], now: number, minAgeMs = 2 * 60_000): { ts: string }[] {
  return scans.filter((s) => { const t = Date.parse(s.ts.replace(/Z?$/, "Z")); return isFinite(t) && now - t >= minAgeMs; });
}

export async function fetchRadar(): Promise<{ radar: RadarFrames; sourceTime: string | null }> {
  try {
    const end = new Date(), start = new Date(end.getTime() - 2.5 * 3_600_000);
    const r = await getJson<{ scans: { ts: string }[] }>(iemListUrl(start, end));
    // v0.6.1: polled every 60 s. The newest scan is used as soon as it is ~2 min old (IEM tiles lag a little behind the list).
    const scans = usableScans(r.scans ?? [], end.getTime());
    const frames = pickIemFrames(scans);
    if (!frames.length) throw new Error("IEM returned no radar scans");
    const latestScan = frames.at(-1)!.time, prevScan = scans.length > 1 ? new Date(Date.parse(scans.at(-3)?.ts.replace(/Z?$/, "Z") ?? scans[0].ts.replace(/Z?$/, "Z"))).toISOString() : null;
    return { radar: { host: IEM_TILE_HOST, kind: "iem", frames, generated: latestScan, latestScan, prevScan, checked: end.toISOString() }, sourceTime: latestScan };
  } catch (e) {
    const r = await getJson<{ host: string; generated: number; radar: { past: { time: number; path: string }[] } }>(RAINVIEWER_URL).catch(() => { throw e; });
    const frames = (r.radar?.past ?? []).map((f) => ({ time: new Date(f.time * 1000).toISOString(), path: f.path }));
    return { radar: { host: r.host, kind: "rainviewer", frames, generated: r.generated ? new Date(r.generated * 1000).toISOString() : null }, sourceTime: frames.at(-1)?.time ?? null };
  }
}
