import { describe, expect, it } from "vitest";
import { activeAt, hazardsAtPoint, parseIemSbw, parseNwsHazards, parseSpcWatches, PLAIN } from "../src/sources/hazards.js";

const NOW = Date.parse("2026-10-09T19:00:00Z");
const box = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

// Shape of IEM json/spcwatch.py (trimmed from a live response).
const spc = { type: "FeatureCollection", features: [
  { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [box(-87, 29, -82, 31.5).coordinates] },
    properties: { sel: "SEL7", type: "TOR", number: 677, is_pds: false, year: 2026, spcurl: "https://www.spc.noaa.gov/products/watch/2026/ww0677.html", issue: "2026-10-09T17:20:00Z", expire: "2026-10-10T01:00:00Z" } },
  { type: "Feature", geometry: box(-90, 30, -88, 32), properties: { type: "SVR", number: 670, year: 2026, issue: "2026-10-09T10:00:00Z", expire: "2026-10-09T18:00:00Z" } },
] };

// Shape of api.weather.gov/alerts/active features.
const nws = { features: [
  { id: "https://api.weather.gov/alerts/urn:oid:tor1", geometry: box(-86.0, 30.6, -85.6, 30.9), properties: {
    id: "urn:oid:tor1", event: "Tornado Warning", senderName: "NWS Mobile AL", headline: "Tornado Warning issued October 9 at 3:00PM EDT until 3:45PM EDT",
    description: "At 300 PM EDT, a severe thunderstorm capable of producing a tornado was located...", instruction: "TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building.",
    onset: "2026-10-09T15:00:00-04:00", expires: "2026-10-09T15:45:00-04:00", ends: "2026-10-09T15:45:00-04:00", messageType: "Alert", affectedZones: [] } },
  { id: "ffa1", geometry: null, properties: { id: "ffa1", event: "Flash Flood Watch", senderName: "NWS Mobile AL", onset: "2026-10-09T20:00:00-04:00", ends: "2026-10-10T14:00:00-04:00",
    expires: "2026-10-10T04:00:00-04:00", affectedZones: ["https://api.weather.gov/zones/forecast/FLZ108"], areaDesc: "Sample County" } },
  { id: "x", geometry: box(0, 0, 1, 1), properties: { event: "Special Weather Statement", expires: "2026-10-10T00:00:00Z" } },
  { id: "old", geometry: box(0, 0, 1, 1), properties: { event: "Tornado Warning", expires: "2026-10-09T18:00:00Z" } },
] };

describe("hazards: SPC watches", () => {
  const w = parseSpcWatches(spc, NOW);
  it("keeps active watches, drops expired", () => { expect(w).toHaveLength(1); expect(w[0].title).toBe("Tornado Watch 677"); });
  it("plain-English label, issuer, expiry", () => {
    expect(w[0].kind).toBe("tornadoWatch"); expect(w[0].plain).toBe(PLAIN.tornadoWatch);
    expect(w[0].issuer).toMatch(/Storm Prediction Center/); expect(w[0].expires).toBe("2026-10-10T01:00:00.000Z");
  });
});

describe("hazards: NWS warnings", () => {
  const h = parseNwsHazards(nws, NOW);
  it("keeps tornado warnings + flash flood watches only, active ones", () => expect(h.map((x) => x.kind)).toEqual(["tornadoWarning", "flashFloodWatch"]));
  it("official text verbatim", () => {
    expect(h[0].instruction).toBe(nws.features[0].properties.instruction);
    expect(h[0].description).toBe(nws.features[0].properties.description);
  });
  it("ends wins over expires; zone list kept for watches with no polygon", () => {
    expect(h[1].expires).toBe("2026-10-10T18:00:00.000Z"); expect(h[1].geometry).toBeNull(); expect(h[1].zones).toHaveLength(1);
  });
  it("tornado emergency is titled as such", () => {
    const e = parseNwsHazards({ features: [{ ...nws.features[0], properties: { ...nws.features[0].properties, description: "...THIS IS A TORNADO EMERGENCY FOR..." } }] }, NOW);
    expect(e[0].title).toBe("Tornado Emergency");
  });
});

describe("hazards: IEM backup", () => {
  it("TO/FF warnings only", () => {
    const r = parseIemSbw({ features: [
      { geometry: box(-84, 30, -83, 31), properties: { phenomena: "TO", significance: "W", wfo: "TAE", eventid: 5, year: 2026, polygon_begin: "2026-10-09T18:50:00Z", polygon_end: "2026-10-09T19:30:00Z" } },
      { geometry: box(-84, 30, -83, 31), properties: { phenomena: "FL", significance: "W", polygon_end: "2026-10-10T19:30:00Z" } },
      { geometry: box(-84, 30, -83, 31), properties: { phenomena: "FF", significance: "W", wfo: "TAE", eventid: 9, year: 2026, polygon_end: "2026-10-10T00:00:00Z" } },
    ] }, NOW);
    expect(r.map((x) => x.kind)).toEqual(["tornadoWarning", "flashFloodWarning"]);
  });
});

describe("hazards: time + point", () => {
  const all = [...parseSpcWatches(spc, NOW), ...parseNwsHazards(nws, NOW)];
  it("active at slider time", () => {
    expect(activeAt(all, NOW).map((x) => x.kind)).toEqual(["tornadoWatch", "tornadoWarning"]);         // watch not started yet
    expect(activeAt(all, Date.parse("2026-10-10T02:00:00Z")).map((x) => x.kind)).toEqual(["flashFloodWatch"]); // TOR watch + warning expired
  });
  it("home inside the tornado warning polygon -> hit; outside -> none", () => {
    expect(hazardsAtPoint(activeAt(all, NOW), 30.75, -85.8).map((x) => x.kind)).toEqual(["tornadoWatch", "tornadoWarning"]);
    expect(hazardsAtPoint(activeAt(all, NOW), 33, -80)).toHaveLength(0);
  });
});
