import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { loadHome, loadThresholds, ODIN_FIPS, OUTAGE_ARCGIS_NAME, OUTAGE_ARCGIS_URL, type Home } from "./config.js";
import { readCache, writeCache } from "./cache.js";
import { HttpError } from "./http.js";
import { fetchNhc, NHC_URL, type RawStorm } from "./sources/nhc.js";
import { buildStormGis } from "./sources/nhcGis.js";
import { dropTimelines, updateTimeline } from "./advisories.js";
import { fetchForecast, fetchNwsAlerts, nwsAlertsUrl, nwsPointsUrl } from "./sources/nws.js";
import { fetchRadar, RADAR_URL } from "./sources/radar.js";
import { fetchUsgs, usgsUrl } from "./sources/usgs.js";
import { fetchNdbc, NDBC_STATIONS_URL } from "./sources/ndbc.js";
import { COOPS_URL, fetchCoops } from "./sources/coops.js";
import { fetchLocalObs, pointsUrl } from "./sources/localObs.js";
import { fetchArcgisOutages, fetchOdin, ODIN_URL, POWER_LINKS } from "./sources/power.js";
import { applyHysteresis, computeThreat, type HystState } from "./threat.js";
import { diffEvents, mkEvent } from "./events.js";
import { arrivalFromIsochrones, bearingDeg, cardinal, distanceMi, motionCpa, pointInGeometry, trackCpa } from "./geo.js";
import { activeAt, fetchHazards, hazardsAtPoint, nwsHazardsUrl } from "./sources/hazards.js";
import type { FeedStatus, Hazard, Snapshot, Storm, StormGis } from "./types.js";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const EMPTY: Omit<Snapshot, "home"> = {
  version: "", gisVersion: "", generatedAt: new Date().toISOString(), storms: [], alerts: [], forecast: null,
  gauges: [], buoys: [], tides: [], localObs: null, radar: null, power: { local: null, odin: null, links: POWER_LINKS }, events: [],
  threat: { level: "DATA STALE", reasons: ["No data yet"] }, feeds: {},
  hazards: [], homeHazardIds: [], hazardsVersion: "", hazardNotes: [],
};
const cached = readCache<Partial<Snapshot>>("snapshot");
let snapshot: Snapshot = { ...EMPTY, ...(cached ?? {}), home: loadHome() } as Snapshot;
snapshot.power = { ...EMPTY.power, ...(snapshot.power ?? {}), links: POWER_LINKS };
if (!OUTAGE_ARCGIS_URL) { snapshot.power.local = null; delete snapshot.feeds?.power; }
if (!ODIN_FIPS) { snapshot.power.odin = null; delete snapshot.feeds?.odin; }
if (!snapshot.home.configured) { snapshot.alerts = []; snapshot.forecast = null; snapshot.gauges = []; for (const k of ["nws", "forecast", "usgs"]) delete snapshot.feeds?.[k]; }
snapshot.tides ??= []; snapshot.localObs ??= null;
snapshot.hazards ??= []; snapshot.homeHazardIds ??= []; snapshot.hazardsVersion ??= ""; snapshot.hazardNotes ??= [];
export const getSnapshot = () => snapshot;

// Severe-weather hazard shapes (last good), served by /api/hazards. Expired ones drop out on every rebuild.
let hazardList: Hazard[] = readCache<Hazard[]>("hazards") ?? [];
export const getHazards = () => ({ version: snapshot.hazardsVersion, generatedAt: snapshot.generatedAt, hazards: hazardList.filter((h) => Date.parse(h.expires) > Date.now()) });

// Per-storm GIS (last good), keyed by storm id.
type GisEntry = StormGis & { advisoryText: string | null };
const gisByStorm = new Map<string, GisEntry>(Object.entries(readCache<Record<string, GisEntry>>("gis-current") ?? {}));
export const getGis = () => Object.fromEntries([...gisByStorm].map(([k, { advisoryText: _t, ...g }]) => [k, g]));
let rawStorms: RawStorm[] = [];

let hyst: HystState | null = snapshot.threat?.level ? { level: snapshot.threat.level, belowSince: null } : null;
const memo = new Map<string, number>();
let lastVersion = snapshot.version;

function feed(key: string, source: string, url: string, pollSeconds: number): FeedStatus {
  const f = (snapshot.feeds[key] ??= { source, url, pollSeconds, lastSuccess: null, lastAttempt: null, sourceTime: null, error: null });
  f.source = source; f.url = url; f.pollSeconds = pollSeconds;
  return f;
}

/** Derived per-storm fields from GIS + home (estimates, all from live data). */
function derive(s: Storm, home: Home): Storm {
  // No location set: never compute home-relative numbers against the neutral map center.
  if (!home.configured) return { ...s, inCone: null, tsArrival: null, trackCpa: null, motionCpa: null, advisoryText: gisByStorm.get(s.id)?.advisoryText ?? null };
  const d = distanceMi(home.lat, home.lon, s.lat, s.lon), b = bearingDeg(home.lat, home.lon, s.lat, s.lon);
  const g = gisByStorm.get(s.id);
  const cone = g?.cone?.features?.[0]?.geometry;
  const isoOf = (fc: GeoJSON.FeatureCollection | null | undefined) =>
    (fc?.features ?? []).map((f) => ({ time: (f.properties as any).time as string, line: (f.geometry as GeoJSON.LineString).coordinates }));
  const e = g?.toaEarliest ? arrivalFromIsochrones(s, home, isoOf(g.toaEarliest)) : null;
  const m = g?.toaMostLikely ? arrivalFromIsochrones(s, home, isoOf(g.toaMostLikely)) : null;
  const pts = (g?.forecastPoints?.features ?? [])
    .map((f) => ({ lat: (f.geometry as GeoJSON.Point).coordinates[1], lon: (f.geometry as GeoJSON.Point).coordinates[0], time: (f.properties as any).time as string }))
    .filter((p) => p.time);
  const tc = pts.length ? trackCpa(home, pts) : null;
  const mc = s.movementDirDeg != null && s.movementSpeedMph != null
    ? motionCpa(home, { lat: s.lat, lon: s.lon, dirDeg: s.movementDirDeg, speedMph: s.movementSpeedMph, time: s.lastUpdate }) : null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    ...s,
    distanceMi: r1(d), bearingDeg: Math.round(b), bearingCardinal: cardinal(b),
    inCone: cone ? pointInGeometry(home.lon, home.lat, cone) : null,
    tsArrival: g && (g.toaEarliest || g.toaMostLikely) ? {
      earliest: e?.time ?? null, mostLikely: m?.time ?? null, earliestBound: e?.bound ?? null, mostLikelyBound: m?.bound ?? null,
      advisoryNumber: g.advisoryNumber,
    } : null,
    trackCpa: tc ? { ...tc, distanceMi: r1(tc.distanceMi) } : null,
    motionCpa: mc ? { ...mc, distanceMi: r1(mc.distanceMi) } : null,
    advisoryText: g?.advisoryText ?? null,
  };
}

function contentHash(s: Snapshot) {
  const { generatedAt: _g, feeds: _f, version: _v, ...rest } = s;
  return createHash("sha1").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}

function rebuild() {
  const t = loadThresholds();
  const home = loadHome();
  const now = Date.now();
  const feeds = Object.values(snapshot.feeds);
  const allStale = feeds.length > 0 && feeds.every((f) => !f.lastSuccess || now - Date.parse(f.lastSuccess) > t.allFeedsStaleMinutes * 60_000);
  const prev = snapshot.version ? structuredClone(snapshot) : null;
  const storms = snapshot.storms.map((s) => derive(s, home));
  if (home.configured) storms.sort((a, b) => a.distanceMi - b.distanceMi);
  // Hazards: keep anything not yet expired (future onsets stay so the slider can show them).
  hazardList = hazardList.filter((h) => Date.parse(h.expires) > now);
  const hazardsVersion = createHash("sha1").update(hazardList.map((h) => `${h.id}:${h.expires}`).join("|")).digest("hex").slice(0, 12);
  const homeHazards = home.configured ? hazardsAtPoint(activeAt(hazardList, now), home.lat, home.lon) : [];
  const computed0 = home.configured ? computeThreat(snapshot.alerts, storms, t, allStale, now)
    : { level: "SET LOCATION" as const, reasons: ["No location set. Add HOME_LAT and HOME_LON to your .env file and restart to get a threat level, local alerts and winds for your place."] };
  // A tornado or flash flood warning polygon over the home point is RED even if the point alert feed lags.
  const homeWarn = homeHazards.filter((x) => x.kind === "tornadoWarning" || x.kind === "flashFloodWarning");
  const computed = homeWarn.length && computed0.level !== "DATA STALE" && computed0.level !== "SET LOCATION"
    ? { level: "RED" as const, reasons: [...homeWarn.map((x) => `${x.title} polygon covers your home until ${new Date(x.expires).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET (${x.issuer})`), ...computed0.reasons] }
    : computed0;
  const h = applyHysteresis(hyst, computed.level, t.stepDownHysteresisMinutes ?? 30, now);
  hyst = h.state;
  const reasons = h.holdUntil
    ? [...computed.reasons, `Holding ${h.state.level} until ${new Date(h.holdUntil).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET (step-down delay); computed ${computed.level}`]
    : computed.reasons;
  const gisVersion = [...gisByStorm.values()].map((g) => `${g.stormId}:${g.advisoryNumber}:${g.cone ? 1 : 0}${g.toaEarliest ? 1 : 0}`).join("|");
  const next: Snapshot = {
    ...snapshot, home, storms, gisVersion,
    hazards: hazardList.map(({ geometry: _g, ...rest }) => rest), homeHazardIds: homeHazards.map((x) => x.id), hazardsVersion,
    generatedAt: new Date().toISOString(),
    threat: { level: h.state.level, reasons, computedLevel: computed.level, holdUntil: h.holdUntil },
  };
  const evs = diffEvents(prev, next, {
    pressureDropMb: t.notify?.pressureDropMb ?? 10, gaugeRiseFt3h: t.notify?.gaugeRiseFt3h ?? 1,
    nearOutageMi: t.notify?.nearOutageMi ?? 2, staleFeedMinutes: t.notify?.staleFeedMinutes ?? t.allFeedsStaleMinutes,
  }, memo);
  if (!prev && next.events.length === 0) next.events = [mkEvent("start", "STORMWATCH online. Polling live feeds.", "info")];
  // De-duplicate against recent identical events (e.g. after a restart, or smoke + dev sharing the cache).
  const recent = (e: { text: string; time: string }) => next.events.some((x) => x.text === e.text && Date.parse(e.time) - Date.parse(x.time) < 3 * 3_600_000);
  next.events = [...evs.filter((e) => !recent(e)).reverse(), ...next.events].slice(0, 40);
  next.version = contentHash(next);
  snapshot = next;
  writeCache("snapshot", snapshot);
  if (snapshot.version !== lastVersion) { lastVersion = snapshot.version; bus.emit("snapshot", snapshot); }
  else bus.emit("feeds", { generatedAt: snapshot.generatedAt, feeds: snapshot.feeds });
}

/**
 * Threat level for a searched place (browser-selected, never stored): same rules as home, using the place's own
 * NWS alerts, storm distance from the place, and any tornado / flash flood warning polygon over the place.
 */
export function threatForPlace(p: { lat: number; lon: number }, alerts: Snapshot["alerts"]): Snapshot["threat"] {
  const t = loadThresholds();
  const place: Home = { name: "the selected place", lat: p.lat, lon: p.lon, configured: true };
  const storms = snapshot.storms.map((s) => derive(s, place)).sort((a, b) => a.distanceMi - b.distanceMi);
  const c = computeThreat(alerts, storms, t, false, Date.now());
  const warn = hazardsAtPoint(activeAt(hazardList, Date.now()), p.lat, p.lon).filter((x) => x.kind === "tornadoWarning" || x.kind === "flashFloodWarning");
  const reasons = c.reasons.map((r) => r.replace(/\byour point\b/g, "this place").replace(/\bof you\b/g, "of this place"));
  return warn.length ? { level: "RED", reasons: [...warn.map((x) => `${x.title} polygon covers this place (${x.issuer})`), ...reasons], computedLevel: "RED", holdUntil: null }
    : { level: c.level, reasons, computedLevel: c.level, holdUntil: null };
}

interface Job { key: string; source: string; url: () => string; run: () => Promise<string | null>; enabled?: () => boolean }
const needsHome = () => loadHome().configured;

const jobs: Job[] = [
  {
    key: "nhc", source: "NHC CurrentStorms.json", url: () => NHC_URL,
    run: async () => { const r = await fetchNhc(loadHome()); snapshot.storms = r.storms; rawStorms = r.raw; return r.sourceTime; },
  },
  {
    // Cone / track / warnings / TOA / advisory text. Only downloads when an advisory number changes (cached per advisory).
    key: "nhcgis", source: "NHC GIS + public advisory", url: () => "https://www.nhc.noaa.gov/gis/",
    run: async () => {
      const errs: string[] = [];
      let latest: string | null = null;
      for (const s of rawStorms) {
        try { gisByStorm.set(s.id, await buildStormGis(s)); }
        catch (e) {
          const partial = (e as { partial?: GisEntry }).partial;
          const prevG = gisByStorm.get(s.id);
          if (partial && (!prevG || prevG.advisoryNumber !== partial.advisoryNumber)) gisByStorm.set(s.id, partial);
          errs.push(`${s.id}: ${(e as Error).message}`);
        }
        const iss = gisByStorm.get(s.id)?.issuance;
        if (iss && (!latest || iss > latest)) latest = iss;
      }
      for (const id of [...gisByStorm.keys()]) if (!rawStorms.some((s) => s.id === id)) gisByStorm.delete(id);
      writeCache("gis-current", Object.fromEntries(gisByStorm));
      if (errs.length) throw new Error(errs.join("; "));
      return latest;
    },
  },
  {
    // Unified UTC timeline: ATCF b-deck (best track), TCM forecast/advisory text (taus + wind radii), a-deck OFCL backfill.
    key: "timeline", source: "NHC ATCF best track + forecast/advisory (TCM)", url: () => "https://ftp.nhc.noaa.gov/atcf/btk/",
    run: async () => {
      const errs: string[] = [];
      let latest: string | null = null;
      for (const s of rawStorms) {
        try { const t = await updateTimeline(s); const iss = t.latest?.issuedUTC ?? null; if (iss && (!latest || iss > latest)) latest = iss; }
        catch (e) { errs.push(`${s.id}: ${(e as Error).message}`); }
      }
      dropTimelines(rawStorms.map((s) => s.id.toLowerCase()));
      if (errs.length && errs.length === rawStorms.length) throw new Error(errs.join("; "));
      return latest;
    },
  },
  {
    key: "nws", source: "NWS alerts (api.weather.gov)", url: () => nwsAlertsUrl(loadHome()),
    run: async () => { const r = await fetchNwsAlerts(loadHome()); snapshot.alerts = r.alerts; return r.sourceTime; }, enabled: needsHome,
  },
  {
    key: "forecast", source: "NWS hourly + gridpoint forecast", url: () => nwsPointsUrl(loadHome()),
    run: async () => { const r = await fetchForecast(loadHome()); snapshot.forecast = r.forecast; return r.sourceTime; }, enabled: needsHome,
  },
  {
    // Tornado / severe thunderstorm watches (SPC via IEM) + NWS tornado warnings, flash flood warnings and watches. Nationwide.
    key: "hazards", source: "SPC watches (IEM) + NWS tornado and flash flood alerts", url: () => nwsHazardsUrl(),
    run: async () => {
      const r = await fetchHazards();
      hazardList = r.hazards; snapshot.hazardNotes = r.notes; writeCache("hazards", hazardList);
      return r.sourceTime;
    },
  },
  { key: "radar", source: "NEXRAD radar composite (Iowa Environmental Mesonet)", url: () => RADAR_URL, run: async () => { const r = await fetchRadar(); snapshot.radar = r.radar; return r.sourceTime; } },
  { key: "usgs", source: "USGS river gauges near you (NWIS)", url: () => usgsUrl(loadHome()), run: async () => { const r = await fetchUsgs(loadHome()); snapshot.gauges = r.gauges; return r.sourceTime; }, enabled: needsHome },
  {
    key: "ndbc", source: "NDBC buoys near storm", url: () => NDBC_STATIONS_URL,
    run: async () => { const r = await fetchNdbc(snapshot.storms[0] ?? null); snapshot.buoys = r.buoys; return r.sourceTime; },
  },
  {
    key: "coops", source: "NOAA CO-OPS water levels (Tides and Currents)", url: () => COOPS_URL,
    run: async () => { const r = await fetchCoops(loadThresholds().coopsStations ?? []); snapshot.tides = r.tides; return r.sourceTime; },
    enabled: () => (loadThresholds().coopsStations ?? []).length > 0,
  },
  {
    key: "obs", source: "Nearest NWS weather station (api.weather.gov)", url: () => pointsUrl(loadHome()),
    run: async () => { const r = await fetchLocalObs(loadHome()); snapshot.localObs = r.obs; return r.sourceTime; }, enabled: needsHome,
  },
  {
    // Optional plugin (off by default): set OUTAGE_ARCGIS_URL in .env. See docs/DATA-SOURCES.md.
    key: "power", source: `${OUTAGE_ARCGIS_NAME} (optional plugin)`, url: () => OUTAGE_ARCGIS_URL,
    run: async () => { const r = await fetchArcgisOutages(loadHome()); snapshot.power = { ...snapshot.power, local: r.local }; return r.sourceTime; },
    enabled: () => needsHome() && !!OUTAGE_ARCGIS_URL,
  },
  {
    // Optional plugin (off by default): set ODIN_FIPS in .env.
    key: "odin", source: `ORNL ODIN (county ${ODIN_FIPS || "not set"})`, url: () => ODIN_URL,
    run: async () => { const r = await fetchOdin(); snapshot.power = { ...snapshot.power, odin: r.odin }; return r.sourceTime; },
    enabled: () => !!ODIN_FIPS,
  },
];
const POLL_KEY: Record<string, string> = { nhcgis: "nhc", timeline: "nhc" };

let retryAfter = new Map<string, number>();
export async function runJob(job: Job): Promise<boolean> {
  const t = loadThresholds();
  const f = feed(job.key, job.source, job.url(), t.pollSeconds[POLL_KEY[job.key] ?? job.key] ?? 300);
  f.lastAttempt = new Date().toISOString();
  try {
    f.sourceTime = (await job.run()) ?? f.sourceTime;
    f.lastSuccess = new Date().toISOString();
    f.error = null;
    retryAfter.delete(job.key);
    return true;
  } catch (e) {
    f.error = (e as Error).message.slice(0, 300); // keep last-known-good data
    if (e instanceof HttpError && e.retryAfterSec) retryAfter.set(job.key, e.retryAfterSec);
    return false;
  } finally {
    rebuild();
  }
}

/** Each job polls on its own interval, with exponential backoff on failure (max 30 min) and Retry-After honored. */
export function startPolling() {
  // NHC first, then its GIS (needs the raw storm list), then everything else staggered a little.
  const order = ["nhc", "nhcgis", "timeline", "nws", "hazards", "forecast", "radar", "usgs", "ndbc", "coops", "obs", "power", "odin"];
  order.forEach((key, i) => {
    const job = jobs.find((j) => j.key === key)!;
    if (job.enabled && !job.enabled()) return; // feature off (no location set, or optional plugin not configured)
    let failures = 0;
    const tick = async () => {
      const ok = await runJob(job);
      failures = ok ? 0 : failures + 1;
      const base = (loadThresholds().pollSeconds[POLL_KEY[key] ?? key] ?? 300) * 1000;
      let delay = ok ? base : Math.min(base * 2 ** failures, 30 * 60_000);
      const ra = retryAfter.get(key);
      if (ra) delay = Math.max(delay, ra * 1000);
      setTimeout(tick, delay);
    };
    setTimeout(tick, key === "nhcgis" ? 4000 : key === "timeline" ? 6000 : i * 700);
  });
  // Re-evaluate staleness / hysteresis every 30 s even if no feed returns.
  setInterval(rebuild, 30_000);
}

/** One sequential pass over every feed (smoke test). */
export async function runAllOnce() {
  const out: Record<string, boolean> = {};
  for (const j of jobs) if (!j.enabled || j.enabled()) out[j.key] = await runJob(j);
  return out;
}
