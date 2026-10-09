import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { HOST, loadLandmarks, PORT, ROOT } from "./config.js";
import { evacZone } from "./sources/evac.js";
import { cleanQuery, geocode, nearbyOutages, placeWeather, validLatLon } from "./sources/place.js";
import { getTimelines, listAdvisories, loadAdvisory } from "./advisories.js";
import { threatForPlace, bus, getGis, getHazards, getSnapshot, startPolling } from "./poller.js";
import { localFeed } from "./sources/localFeed.js";
import { pointCard } from "./sources/pointCard.js";
import { radarPoint, scanFor } from "./sources/radarPoint.js";
import { rainTotals } from "./sources/rainTotals.js";
import { radarMotion, stormMotion, type RadarMotion } from "./sources/radarMotion.js";
import { getOutageAreas, startOutageHistory } from "./sources/outageAreas.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/api/health", async () => ({ ok: true, version: getSnapshot().version, generatedAt: getSnapshot().generatedAt }));
/** v0.7 auto-reload: the open page polls this and reloads when the code (git sha) or the web build changes. */
const APP_VERSION = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string; } catch { return "unknown"; } })();
const GIT_SHA = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "unknown"; } })();
const STARTED_AT = new Date().toISOString();
app.get("/api/version", async (_req, reply) => {
  let builtAt: string | null = null;
  try { builtAt = statSync(path.join(ROOT, "web", "dist", "index.html")).mtime.toISOString(); } catch { builtAt = null; }
  reply.header("Cache-Control", "no-store");
  return { version: APP_VERSION, sha: GIT_SHA, builtAt, startedAt: STARTED_AT };
});
app.get("/api/snapshot", async () => getSnapshot());
app.get("/api/gis", async () => getGis());
/** Active watch / warning shapes (GeoJSON geometry + verbatim NWS text). Re-fetch when snapshot.hazardsVersion changes. */
app.get("/api/hazards", async () => getHazards());

/** Unified storm timelines (best track + latest official forecast + advisory list), keyed by storm id. */
app.get("/api/timeline", async () => getTimelines());
/** One stored advisory snapshot (immutable), for the advisory selector. */
app.get("/api/advisory/:storm/:adv", async (req, reply) => {
  const { storm, adv } = req.params as { storm: string; adv: string };
  const r = /^[a-z]{2}\d{6}$/i.test(storm) ? loadAdvisory(storm, adv) : null;
  return r ?? reply.code(404).send({ error: "advisory not stored" });
});
app.get("/api/advisories/:storm", async (req) => ({ advisories: /^[a-z]{2}\d{6}$/i.test((req.params as any).storm) ? listAdvisories((req.params as any).storm) : [] }));

/** Public map places from config/landmarks.json (re-read on each request so edits show after a reload). */
app.get("/api/landmarks", async () => ({ landmarks: loadLandmarks() }));

// Selected-location routes. PRIVACY: logLevel "warn" = no request log lines (no addresses or coordinates in logs),
// errors are generic, nothing is written to disk. The browser keeps the selected location in localStorage only.
const quiet = { logLevel: "warn" as const };
app.get("/api/geocode", quiet, async (req, reply) => {
  const q = cleanQuery((req.query as any)?.q);
  if (!q) return reply.code(400).send({ error: "Type at least 3 characters: an address, a city or a ZIP code." });
  try { return { results: await geocode(q) }; } catch { return reply.code(502).send({ error: "Location search is not reachable right now. Try again in a minute." }); }
});
/** v0.6.1 "Smooth live radar": drift of the rain pattern between the last two ~10-min-apart scans near a point (ESTIMATE).
 * Cached per ~0.5 degree cell and scan, so it costs two small IEM images per new scan. Falls back to the storm's NHC motion. */
const motionCache = new Map<string, { at: number; m: RadarMotion | null }>();
app.get("/api/radar-motion", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  const r = getSnapshot().radar;
  if (!r?.latestScan || !r.prevScan || r.kind !== "iem") return { motion: null, note: "No recent radar scans to compare." };
  const key = `${Math.round(p.lat * 2)}:${Math.round(p.lon * 2)}:${r.latestScan}`;
  let hit = motionCache.get(key);
  if (!hit) {
    let m: RadarMotion | null = null;
    try { m = await radarMotion(p.lat, p.lon, r.prevScan, r.latestScan); } catch { m = null; }
    const s = getSnapshot().storms?.[0];
    if (!m && s?.movementDirDeg != null && s.movementSpeedMph != null) m = stormMotion(s.movementDirDeg, s.movementSpeedMph, p.lat, p.lon);
    hit = { at: Date.now(), m }; motionCache.set(key, hit);
    for (const [k, v] of motionCache) if (Date.now() - v.at > 30 * 60_000) motionCache.delete(k);
  }
  return { motion: hit.m, latestScan: r.latestScan };
});
/** v0.6.1 tap card for one exact point at time t (ms or ISO; default now). */
app.get("/api/point", quiet, async (req, reply) => {
  const q = req.query as any, p = validLatLon(q?.lat, q?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  const t = q?.t ? (/^\d+$/.test(String(q.t)) ? Number(q.t) : Date.parse(String(q.t))) : Date.now();
  if (!Number.isFinite(t)) return reply.code(400).send({ error: "bad time" });
  const radarFn = async (la: number, lo: number, tt: number) => {
    const r = getSnapshot().radar, scan = scanFor(tt, Date.now(), r?.kind === "iem" ? r.latestScan ?? null : null);
    if (!scan) return { none: "Radar is observed only. For a future time, see the forecast radar on the map (Next 3 hours)." };
    if (Date.now() - Date.parse(scan) > 7 * 24 * 3.6e6) return { none: "No radar archive this far back here." };
    return radarPoint(la, lo, scan);
  };
  try { return await pointCard(p.lat, p.lon, t, undefined, undefined, radarFn); } catch { return reply.code(502).send({ error: "Data for this point is not available right now." }); }
});
/** v0.7 rain so far at one point (MRMS 1 h / 24 h / 72 h). */
app.get("/api/rain", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  try { return await rainTotals(p.lat, p.lon); } catch { return reply.code(502).send({ error: "Rain totals are not available right now." }); }
});
app.get("/api/place", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  try { const w = await placeWeather(p); return { ...w, threat: threatForPlace(p, w.alerts) }; } catch { return reply.code(502).send({ error: "National Weather Service data is not available for this location right now." }); }
});
app.get("/api/evac", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  try { return await evacZone(p); } catch { return reply.code(502).send({ error: "The Florida evacuation zone map is not reachable right now. Check your county emergency management website." }); }
});
app.get("/api/localfeed", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  try { return await localFeed(p); } catch { return reply.code(502).send({ error: "National Weather Service updates are not reachable right now." }); }
});
app.get("/api/outages", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  try { return await nearbyOutages(p); } catch { return reply.code(502).send({ error: "Outage data is not available right now." }); }
});

/** Utility-wide outage totals, % out, region/county shapes and our own 24 h history. No location in or out. */
app.get("/api/outage-areas", async (_req, reply) => {
  try { return await getOutageAreas(); } catch { return reply.code(502).send({ error: "Outage data is not available right now." }); }
});

app.register(async (f) => {
  f.get("/ws", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "snapshot", snapshot: getSnapshot() }));
    const pushSnap = (s: unknown) => socket.send(JSON.stringify({ type: "snapshot", snapshot: s }));
    const pushFeeds = (x: unknown) => socket.send(JSON.stringify({ type: "feeds", ...(x as object) }));
    bus.on("snapshot", pushSnap);
    bus.on("feeds", pushFeeds);
    socket.on("close", () => { bus.off("snapshot", pushSnap); bus.off("feeds", pushFeeds); });
  });
});

// Production mode: serve the built HUD (web/dist) from this same port.
const dist = path.join(ROOT, "web", "dist");
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, setHeaders: (res, file) => { if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }); // wildcard: picks up rebuilt assets without a restart
  app.setNotFoundHandler((req, reply) => req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"));
}

startPolling();
startOutageHistory();
await app.listen({ port: PORT, host: HOST });
