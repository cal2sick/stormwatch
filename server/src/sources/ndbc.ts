import { getText } from "../http.js";
import { readCache, writeCache } from "../cache.js";
import { distanceMi } from "../geo.js";
import type { Buoy } from "../types.js";

export const NDBC_STATIONS_URL = "https://www.ndbc.noaa.gov/activestations.xml";
const rt2 = (id: string) => `https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`;

interface Station { id: string; name: string; lat: number; lon: number }

/** Active met stations, refreshed at most once a day. */
async function stations(): Promise<Station[]> {
  const c = readCache<{ at: string; list: Station[] }>("ndbc-stations");
  if (c && Date.now() - Date.parse(c.at) < 24 * 3_600_000) return c.list;
  const xml = await getText(NDBC_STATIONS_URL, "application/xml");
  const list: Station[] = [];
  for (const m of xml.matchAll(/<station ([^>]+)\/>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (a.met !== "y") continue;
    list.push({ id: a.id, name: a.name, lat: Number(a.lat), lon: Number(a.lon) });
  }
  writeCache("ndbc-stations", { at: new Date().toISOString(), list });
  return list;
}

const val = (s: string | undefined) => (s === undefined || s === "MM" || s === "" ? null : Number(s));

/** Parse the newest row of a realtime2 standard met file. */
export function parseRealtime2(txt: string) {
  const lines = txt.split("\n").filter((l) => l.trim());
  const head = lines[0]?.replace(/^#/, "").trim().split(/\s+/) ?? [];
  const row = lines.find((l) => !l.startsWith("#"))?.trim().split(/\s+/);
  if (!row) return null;
  const g = (k: string) => val(row[head.indexOf(k)]);
  const [Y, M, D, h, mi] = ["YY", "MM", "DD", "hh", "mm"].map((k) => row[head.indexOf(k)]);
  return {
    time: new Date(Date.UTC(+Y, +M - 1, +D, +h, +mi)).toISOString(),
    windDirDeg: g("WDIR"),
    windKt: g("WSPD") == null ? null : Math.round(g("WSPD")! * 1.94384),
    gustKt: g("GST") == null ? null : Math.round(g("GST")! * 1.94384),
    waveFt: g("WVHT") == null ? null : Math.round(g("WVHT")! * 3.28084 * 10) / 10,
    pressureMb: g("PRES"),
    pressureTendencyMb: g("PTDY"),
  };
}

/** The N nearest reporting buoys to the storm center (within maxMi), fetched one at a time. */
export async function fetchNdbc(center: { lat: number; lon: number } | null, n = 4, maxMi = 450): Promise<{ buoys: Buoy[]; sourceTime: string | null }> {
  if (!center) return { buoys: [], sourceTime: null };
  const near = (await stations())
    .map((s) => ({ ...s, d: distanceMi(center.lat, center.lon, s.lat, s.lon) }))
    .filter((s) => s.d <= maxMi).sort((a, b) => a.d - b.d).slice(0, n + 4);
  const buoys: Buoy[] = [];
  for (const s of near) {
    if (buoys.length >= n) break;
    try {
      const obs = parseRealtime2(await getText(rt2(s.id)));
      if (!obs || (obs.windKt == null && obs.pressureMb == null)) continue;
      if (Date.now() - Date.parse(obs.time) > 6 * 3_600_000) continue; // skip stations not reporting
      buoys.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, distanceToStormMi: Math.round(s.d), ...obs });
    } catch { /* station file missing: skip */ }
  }
  const sourceTime = buoys.map((b) => b.time).filter(Boolean).sort().pop() ?? null;
  return { buoys, sourceTime };
}
