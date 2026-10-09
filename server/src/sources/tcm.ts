// NHC Forecast/Advisory (TCM) text product: the official taus, intensity and 34/50/64-kt wind radii.
// Verbatim product from https://www.nhc.noaa.gov/text/MIATCM<bin>.shtml. Parsed, never rewritten.
import type { Quad, TrackFix } from "../types.js";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface TcmParsed { advNum: string; stormId: string | null; issuedUTC: string; points: TrackFix[] }

function ddhhmm(v: string, ref: Date): string {
  const m = /^(\d{2})\/(\d{2})(\d{2})Z$/.exec(v)!;
  let y = ref.getUTCFullYear(), mo = ref.getUTCMonth();
  const day = Number(m[1]);
  if (day < ref.getUTCDate() - 15) { mo += 1; if (mo > 11) { mo = 0; y += 1; } }
  return new Date(Date.UTC(y, mo, day, Number(m[2]), Number(m[3]))).toISOString();
}
const ll = (lat: string, lon: string) => {
  const a = /^([\d.]+)([NS])$/.exec(lat), b = /^([\d.]+)([EW])$/.exec(lon);
  if (!a || !b) return null;
  return { lat: Number(a[1]) * (a[2] === "S" ? -1 : 1), lon: Number(b[1]) * (b[2] === "W" ? -1 : 1) };
};
function radii(block: string, kt: 34 | 50 | 64): Quad | null {
  const m = new RegExp(`^${kt} KT\\.+\\s*(\\d+)NE\\s+(\\d+)SE\\s+(\\d+)SW\\s+(\\d+)NW`, "m").exec(block);
  return m ? ([1, 2, 3, 4].map((i) => Number(m[i])) as Quad) : null;
}

/** Parse the text of a TCM (the <pre> block). Taus are hours from the synoptic time (advisory time minus 3 h). */
export function parseTcm(text: string): TcmParsed | null {
  const t = text.replace(/\r/g, "");
  const adv = /FORECAST\/ADVISORY NUMBER\s+(\w+)/.exec(t)?.[1];
  const iss = /^(\d{2})(\d{2}) UTC \w{3} (\w{3}) (\d{2}) (\d{4})/m.exec(t);
  const at = /CENTER LOCATED NEAR\s+([\d.]+[NS])\s+([\d.]+[EW]) AT (\d{2}\/\d{4}Z)/.exec(t);
  if (!adv || !iss || !at) return null;
  const issued = new Date(Date.UTC(+iss[5], MON.indexOf(iss[3]), +iss[4], +iss[1], +iss[2]));
  const synoptic = Date.parse(ddhhmm(at[3], issued)) - 3 * 3_600_000;
  const id = /\b(AL|EP|CP)(\d{2})(\d{4})\b/.exec(t);
  const points: TrackFix[] = [];
  const head = t.slice(0, t.indexOf("REPEAT...") > 0 ? t.indexOf("REPEAT...") : undefined);
  const p0 = ll(at[1], at[2])!;
  const v0 = /MAX SUSTAINED WINDS\s+(\d+) KT/.exec(head)?.[1];
  const ms = /MINIMUM CENTRAL PRESSURE\s+(\d+) MB/.exec(head)?.[1];
  const t0 = ddhhmm(at[3], issued);
  points.push({ validUTC: t0, tau: (Date.parse(t0) - synoptic) / 3_600_000, ...p0, vmaxKt: v0 ? Number(v0) : null, mslp: ms ? Number(ms) : null,
    r34: radii(head, 34), r50: radii(head, 50), r64: radii(head, 64), src: "OFCL", stormType: null });
  const re = /(?:FORECAST|OUTLOOK) VALID (\d{2}\/\d{4}Z)\s+([\d.]+[NS])\s+([\d.]+[EW])([^\n]*)\n([\s\S]*?)(?=\n\s*\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const p = ll(m[2], m[3]); if (!p) continue;
    const v = ddhhmm(m[1], issued);
    const wind = /MAX WIND\s+(\d+) KT/.exec(m[5])?.[1];
    const tag = m[4].replace(/^\.+/, "").trim();
    points.push({ validUTC: v, tau: Math.round((Date.parse(v) - synoptic) / 3_600_000), ...p, vmaxKt: wind ? Number(wind) : null, mslp: null,
      r34: radii(m[5], 34), r50: radii(m[5], 50), r64: radii(m[5], 64), src: "OFCL", stormType: tag || null });
  }
  return { advNum: adv, stormId: id ? `${id[1]}${id[2]}${id[3]}`.toLowerCase() : null, issuedUTC: issued.toISOString(), points };
}

/** "12A" / "012a" is an intermediate (position-only) public advisory; plain numbers are full advisories. */
export const isIntermediate = (advNum: string) => /[A-Z]$/i.test(advNum.trim());
export const normAdv = (advNum: string) => advNum.trim().replace(/^0+(?=\d)/, "").toUpperCase();
