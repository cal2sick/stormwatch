import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { HOST, PORT, ROOT } from "./config.js";
import { bus, getGis, getHazards, getSnapshot, startPolling } from "./poller.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/api/health", async () => ({ ok: true, version: getSnapshot().version, generatedAt: getSnapshot().generatedAt }));
app.get("/api/snapshot", async () => getSnapshot());
app.get("/api/gis", async () => getGis());
/** Active watch / warning shapes (GeoJSON geometry + verbatim NWS text). Re-fetch when snapshot.hazardsVersion changes. */
app.get("/api/hazards", async () => getHazards());

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
  await app.register(fastifyStatic, { root: dist }); // wildcard: picks up rebuilt assets without a restart
  app.setNotFoundHandler((req, reply) => req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"));
}

startPolling();
await app.listen({ port: PORT, host: HOST });
