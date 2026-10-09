import { describe, expect, it } from "vitest";
import { arcgisToOutages, cleanQuery, inBbox, loadOutageConfig, parseCensus, parseNominatim, validLatLon } from "../src/sources/place.js";

describe("location search", () => {
  it("cleans queries and rejects short ones", () => {
    expect(cleanQuery("  32304 ")).toBe("32304");
    expect(cleanQuery("ab")).toBeNull();
    expect(cleanQuery(42)).toBeNull();
    expect(cleanQuery("x".repeat(500))!.length).toBe(120);
  });
  it("parses US Census matches", () => {
    const r = parseCensus({ result: { addressMatches: [{ matchedAddress: "600 W COLLEGE AVE, TALLAHASSEE, FL, 32301", coordinates: { x: -84.2897, y: 30.4408 } }] } });
    expect(r).toEqual([{ name: "600 W COLLEGE AVE, TALLAHASSEE, FL, 32301", lat: 30.4408, lon: -84.2897, source: "US Census Geocoder" }]);
    expect(parseCensus({ result: { addressMatches: [] } })).toEqual([]);
  });
  it("parses Nominatim results (ZIP / city fallback)", () => {
    const r = parseNominatim([{ display_name: "32304, Tallahassee, Leon County, Florida, United States", lat: "30.4486", lon: "-84.3148" }]);
    expect(r[0]).toEqual({ name: "32304, Tallahassee, Leon County, Florida", lat: 30.4486, lon: -84.3148, source: "OpenStreetMap Nominatim" });
  });
  it("validates and rounds coordinates", () => {
    expect(validLatLon("30.123456", "-84.98766")).toEqual({ lat: 30.1235, lon: -84.9877 });
    expect(validLatLon("100", "0")).toBeNull();
    expect(validLatLon("x", "0")).toBeNull();
  });
});

describe("nearby outages", () => {
  it("registry loads and covers Tallahassee with a point feed and link-outs", () => {
    const c = loadOutageConfig();
    expect(c.radiusMi).toBe(25); expect(c.pollSeconds).toBeGreaterThanOrEqual(180);
    const here = c.sources.filter((s) => inBbox(s.bbox, { lat: 30.44, lon: -84.29 }));
    expect(here.some((s) => s.type === "arcgis")).toBe(true);
    expect(here.some((s) => s.type === "link")).toBe(true);
    expect(c.sources.filter((s) => inBbox(s.bbox, { lat: 40.7, lon: -74 }))).toEqual([]); // New York: no feed -> "say so plainly"
  });
  it("turns ArcGIS points into outages with distance and passed-ETR flag", () => {
    const now = Date.parse("2026-10-09T19:00:00Z");
    const o = arcgisToOutages({ features: [{ attributes: { customers: 12, cause: "Tree", etr: now - 60_000, off: now - 3.6e6 }, geometry: { x: -84.29, y: 30.45 } }, { attributes: {} }] }, { lat: 30.44, lon: -84.29 }, now);
    expect(o).toHaveLength(1);
    expect(o[0].customers).toBe(12); expect(o[0].etrPassed).toBe(true); expect(o[0].distanceMi).toBeCloseTo(0.7, 1);
  });
});
