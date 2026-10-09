// Per-advisory store + unified storm timeline, anchored to NHC products on one UTC clock.
// Each advisory is written once to data/advisories/<storm>/<adv>.json and never overwritten (immutable snapshots).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { getText } from "./http.js";
import { fetchBestTrack, fetchOfcl, ofclByBase, type DeckFix } from "./sources/atcf.js";
import { isIntermediate, normAdv, parseTcm } from "./sources/tcm.js";
import { extractAdvisoryText } from "./sources/nhcGis.js";
import type { RawStorm } from "./sources/nhc.js";
import type { AdvisoryRecord, AdvisorySummary, StormTimeline, TrackFix } from "./types.js";

const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
const dirFor = (stormId: string, root = DATA_DIR) => path.join(root, "advisories", safe(stormId.toLowerCase()));

/** Write once. Returns false if that advisory was already stored (the stored copy wins). */
export function saveAdvisory(rec: AdvisoryRecord, root = DATA_DIR): boolean {
  const dir = dirFor(rec.stormId, root);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safe(rec.advNum)}.json`);
  if (existsSync(file)) return false;
  try { writeFileSync(file, JSON.stringify(rec, null, 1), { flag: "wx" }); return true; } catch { return false; }
}
export function loadAdvisory(stormId: string, advNum: string, root = DATA_DIR): AdvisoryRecord | null {
  const file = path.join(dirFor(stormId, root), `${safe(advNum)}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as AdvisoryRecord; } catch { return null; }
}
export function listAdvisories(stormId: string, root = DATA_DIR): AdvisorySummary[] {
  const dir = dirFor(stormId, root);
  if (!existsSync(dir)) return [];
  const out: AdvisorySummary[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try { const r = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as AdvisoryRecord; out.push({ advNum: r.advNum, kind: r.kind, issuedUTC: r.issuedUTC, source: r.source }); } catch { /* skip */ }
  }
  return out.sort((a, b) => b.issuedUTC.localeCompare(a.issuedUTC) || b.advNum.localeCompare(a.advNum));
}

const strip = ({ baseUTC: _b, ...f }: DeckFix): TrackFix => f;

/** Turn a-deck OFCL forecasts into advisory records (backfill for advisories issued before this app started). */
export function ofclRecords(stormId: string, fixes: DeckFix[]): AdvisoryRecord[] {
  return [...ofclByBase(fixes)].map(([base, pts]) => ({
    stormId, advNum: `OFCL ${base.slice(0, 13).replace(/\D/g, "")}`, kind: "full" as const,
    issuedUTC: new Date(Date.parse(base) + 3 * 3_600_000).toISOString(), synopticUTC: base,
    source: "NHC ATCF a-deck (official forecast, OFCL)", forecastFrom: null, points: pts.map(strip),
  }));
}

/** Latest live position from CurrentStorms.json (updates with intermediate advisories). */
export function liveFix(s: RawStorm): TrackFix | null {
  if (!s.lastUpdate || !isFinite(s.latitudeNumeric) || !isFinite(s.longitudeNumeric)) return null;
  const v = Number(s.intensity), p = Number(s.pressure);
  return { validUTC: new Date(s.lastUpdate).toISOString(), tau: null, lat: s.latitudeNumeric, lon: s.longitudeNumeric,
    vmaxKt: isFinite(v) ? v : null, mslp: isFinite(p) && p > 0 ? p : null, r34: null, r50: null, r64: null, src: "LIVE", stormType: s.classification ?? null };
}

const lastAdeck = new Map<string, number>();
const tl = new Map<string, StormTimeline>();
export const getTimelines = () => Object.fromEntries(tl);

/** Fetch b-deck + TCM (+ a-deck hourly), store new advisories, rebuild the storm's timeline. */
export async function updateTimeline(s: RawStorm): Promise<StormTimeline> {
  const id = s.id.toLowerCase();
  const errs: string[] = [];
  let best: TrackFix[] = tl.get(id)?.best ?? [];
  try { best = (await fetchBestTrack(id)).map(strip); } catch (e) { errs.push(`b-deck: ${(e as Error).message}`); }
  let fullAdv: string | null = null;
  if (s.forecastAdvisory?.url) {
    try {
      const txt = extractAdvisoryText(await getText(s.forecastAdvisory.url));
      const p = txt ? parseTcm(txt) : null;
      if (p && p.points.length) {
        fullAdv = normAdv(p.advNum);
        saveAdvisory({ stormId: id, advNum: fullAdv, kind: "full", issuedUTC: p.issuedUTC, synopticUTC: new Date(Date.parse(p.issuedUTC) - 3 * 3_600_000).toISOString(),
          source: "NHC Forecast/Advisory text (TCM)", forecastFrom: null, points: p.points });
      }
    } catch (e) { errs.push(`TCM: ${(e as Error).message}`); }
  }
  const pub = s.publicAdvisory?.advNum ? normAdv(s.publicAdvisory.advNum) : null;
  const live = liveFix(s);
  if (pub && isIntermediate(pub) && live) {
    saveAdvisory({ stormId: id, advNum: pub, kind: "intermediate", issuedUTC: s.publicAdvisory?.issuance ?? live.validUTC, synopticUTC: null,
      source: "NHC intermediate public advisory (position only)", forecastFrom: fullAdv ?? pub.replace(/[A-Z]$/, ""), points: [live] });
  }
  if (Date.now() - (lastAdeck.get(id) ?? 0) > 60 * 60_000) {
    try { for (const r of ofclRecords(id, await fetchOfcl(id))) saveAdvisory(r); lastAdeck.set(id, Date.now()); }
    catch (e) { errs.push(`a-deck: ${(e as Error).message}`); }
  }
  const all = listAdvisories(id);
  // An a-deck OFCL backfill for the same synoptic time as a stored TCM advisory is the same forecast: keep the TCM one.
  const tcmIssued = new Set(all.filter((a) => !a.advNum.startsWith("OFCL")).map((a) => a.issuedUTC));
  const advisories = all.filter((a) => !(a.advNum.startsWith("OFCL") && tcmIssued.has(a.issuedUTC)));
  const latestFull = advisories.find((a) => a.kind === "full" && !a.advNum.startsWith("OFCL")) ?? advisories.find((a) => a.kind === "full");
  const t: StormTimeline = { stormId: id, name: s.name, best, live, latest: latestFull ? loadAdvisory(id, latestFull.advNum) : null, advisories, updated: new Date().toISOString() };
  tl.set(id, t);
  if (errs.length && !best.length && !t.latest) throw new Error(errs.join("; "));
  return t;
}
export function dropTimelines(activeIds: string[]) { for (const k of [...tl.keys()]) if (!activeIds.includes(k)) tl.delete(k); }
