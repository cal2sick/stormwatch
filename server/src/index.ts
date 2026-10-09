import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { HOST, loadLandmarks, PORT, ROOT } from "./config.js";
import { cleanQuery, geocode, nearbyOutages, placeWeather, validLatLon } from "./sources/place.js";
import { getTimelines, listAdvisories, loadAdvisory } from "./advisories.js";
import { bus, getGis, getHazards, getSnapshot, startPolling } from "./poller.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/api/health", async () => ({ ok: true, version: getSnapshot().version, generatedAt: getSnapshot().generatedAt }));
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
app.get("/api/place", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  try { return await placeWeather(p); } catch { return reply.code(502).send({ error: "National Weather Service data is not available for this location right now." }); }
});
app.get("/api/outages", quiet, async (req, reply) => {
  const p = validLatLon((req.query as any)?.lat, (req.query as any)?.lon);
  if (!p) return reply.code(400).send({ error: "bad lat/lon" });
  try { return await nearbyOutages(p); } catch { return reply.code(502).send({ error: "Outage data is not available right now." }); }
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
await app.listen({ port: PORT, host: HOST });
