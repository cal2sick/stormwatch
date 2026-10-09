// NHC ATCF decks: b-deck (BEST track, past positions) and a-deck OFCL (the official forecast per synoptic time).
// Public, keyless: https://ftp.nhc.noaa.gov/atcf/README. Parsed server-side only.
import { gunzipSync } from "node:zlib";
import { getBytes, getText } from "../http.js";
import type { Quad, TrackFix } from "../types.js";

export const bdeckUrl = (id: string) => `https://ftp.nhc.noaa.gov/atcf/btk/b${id.toLowerCase()}.dat`;
export const adeckUrl = (id: string) => `https://ftp.nhc.noaa.gov/atcf/aid_public/a${id.toLowerCase()}.dat.gz`;
export const archiveDeckUrl = (kind: "a" | "b", id: string) => `https://ftp.nhc.noaa.gov/atcf/archive/${id.slice(-4)}/${kind}${id.toLowerCase()}.dat.gz`;

/** "270N" -> 27.0, "876W" -> -87.6 (tenths of a degree). */
export function atcfLatLon(v: string): number | null {
  const m = /^(\d+)([NSEW])$/.exec(v.trim());
  if (!m) return null;
  const x = Number(m[1]) / 10;
  return m[2] === "S" || m[2] === "W" ? -x : x;
}
/** "2026100918" -> ISO UTC. */
export function dtgToIso(dtg: string): string | null {
  const d = dtg.trim();
  if (!/^\d{10}$/.test(d)) return null;
  return new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10))).toISOString();
}

export interface DeckFix extends TrackFix { baseUTC: string }

/**
 * Parse ATCF deck lines. One fix per (base time, tech, tau); the 34/50/64-kt radii rows are merged.
 * Radii are nautical miles, quadrants NE, SE, SW, NW (only "NEQ" rows are used). 0 = none in that quadrant.
 */
export function parseDeck(text: string, tech: "BEST" | "OFCL"): DeckFix[] {
  const out = new Map<string, DeckFix>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(",").map((x) => x.trim());
    if (c.length < 8 || c[4] !== tech) continue;
    const base = dtgToIso(c[2]); const tau = Number(c[5]);
    const lat = atcfLatLon(c[6]), lon = atcfLatLon(c[7]);
    if (!base || !isFinite(tau) || lat == null || lon == null) continue;
    const valid = new Date(Date.parse(base) + tau * 3_600_000).toISOString();
    const key = `${base}|${tau}`;
    const vmax = Number(c[8]), mslp = Number(c[9]);
    const f = out.get(key) ?? {
      baseUTC: base, validUTC: valid, tau, lat, lon, vmaxKt: isFinite(vmax) && c[8] !== "" ? vmax : null,
      mslp: isFinite(mslp) && mslp > 0 ? mslp : null, r34: null, r50: null, r64: null, src: tech, stormType: c[10] || null,
    };
    const rad = Number(c[11]);
    if ((rad === 34 || rad === 50 || rad === 64) && (c[12] === "NEQ" || c[12] === "AAA")) {
      const q = [13, 14, 15, 16].map((i) => Number(c[i]) || 0) as Quad;
      const quad: Quad = c[12] === "AAA" ? [q[0], q[0], q[0], q[0]] : q;
      if (quad.some((x) => x > 0)) f[`r${rad}` as "r34" | "r50" | "r64"] = quad;
    }
    if (f.mslp == null && isFinite(mslp) && mslp > 0) f.mslp = mslp;
    out.set(key, f);
  }
  return [...out.values()].sort((a, b) => a.validUTC.localeCompare(b.validUTC) || a.baseUTC.localeCompare(b.baseUTC));
}

/** Group a-deck OFCL fixes into one official forecast per synoptic base time. */
export function ofclByBase(fixes: DeckFix[]): Map<string, DeckFix[]> {
  const m = new Map<string, DeckFix[]>();
  for (const f of fixes) { const l = m.get(f.baseUTC) ?? []; l.push(f); m.set(f.baseUTC, l); }
  for (const l of m.values()) l.sort((a, b) => (a.tau ?? 0) - (b.tau ?? 0));
  return m;
}

export async function fetchBestTrack(id: string): Promise<DeckFix[]> {
  return parseDeck(await getText(bdeckUrl(id)), "BEST");
}
export async function fetchOfcl(id: string): Promise<DeckFix[]> {
  return parseDeck(new TextDecoder().decode(gunzipSync(await getBytes(adeckUrl(id)))), "OFCL");
}
