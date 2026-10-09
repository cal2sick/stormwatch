import { describe, expect, it } from "vitest";
import { etrSummary, odinCounties, parseHistory, pct, regionStats, seriesFrom, compareUrlFor } from "../src/sources/outageAreas.js";
import { loadOutageConfig } from "../src/sources/place.js";
import { compareUrl, headlineFor, minutesAgo, outageColor, sparkPoints, sumSeries, trend, utilitiesFor, type UtilityRow } from "../../web/src/outages.js";

const regions: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: ["1 North", "2 East", "5 Outside"].map((NAME) => ({ type: "Feature", properties: { NAME }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })) };
const row = (o: Partial<UtilityRow>): UtilityRow => ({ id: "x", name: "X", kind: "live", out: 0, outages: 0, served: 1000, servedSource: "EIA-861", pct: 0, etr: null, etrPassed: 0, source: "x", sourceTime: "2026-10-09T21:00:00Z", map: null, bbox: [-84.5, 30.3, -84.1, 30.6], note: null, ...o });

describe("outage areas (server, pure)", () => {
  it("percent out rounds to 2 decimals and needs a denominator", () => {
    expect(pct(94, 120220)).toBe(0.08); expect(pct(5, null)).toBeNull(); expect(pct(null, 10)).toBeNull();
  });
  it("matches outage region numbers to region shapes by leading number", () => {
    const r = regionStats(regions, [{ region: 2, customers: 10 }, { region: "2", customers: 5 }, { region: 6, customers: 7 }], 1000);
    const east = r.fc.features.find((f) => (f.properties as any).name === "2 East")!.properties as any;
    expect(east).toMatchObject({ out: 15, outages: 2, pct: 1.5 });
    expect((r.fc.features[0].properties as any).out).toBe(0);
    expect(r.unmatched).toBe(7);
  });
  it("groups ORNL ODIN rows by county, names utilities from EIA ids, % only with meters served", () => {
    const odin = { outage: [
      { communityDescriptor: "12131", metersAffected: 640, names: [{ nameType: "UtilityName", name: "CHOCTAWHATCHE ELEC COOP, INC" }, { nameType: "UtilityId", name: "3502" }], outageArea: { metersServed: null } },
      { communityDescriptor: "12131", metersAffected: 10, names: [{ nameType: "UtilityName", name: "Other" }], outageArea: { metersServed: 1000 } },
      { communityDescriptor: "bad", metersAffected: 1 } ] };
    const c = odinCounties(odin, { "3502": ["Choctawhatchee Electric Cooperative", 66479] });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ fips: "12131", out: 650, served: 1000 });
    expect(c[0].utilities[0]).toMatchObject({ name: "Choctawhatchee Electric Cooperative", utilityCustomers: 66479 });
  });
  it("ETR summary: latest future estimate and count of passed ones", () => {
    expect(etrSummary([{ etr: "2026-10-09T20:00:00Z", etrPassed: true }, { etr: "2026-10-10T01:00:00Z", etrPassed: false }, { etr: null, etrPassed: false }]))
      .toEqual({ etr: "2026-10-10T01:00:00Z", passed: 1 });
  });
  it("history parser skips bad lines and old points; series per source", () => {
    const txt = ['{"t":"2026-10-08T00:00:00Z","out":{"ctu":1}}', "garbage", '{"t":"2026-10-09T20:00:00Z","out":{"ctu":90,"odin:12131":5}}', '{"t":"2026-10-09T20:03:00Z","out":{"ctu":94}}'].join("\n");
    const since = Date.parse("2026-10-09T00:00:00Z");
    const pts = parseHistory(txt, since);
    expect(pts).toHaveLength(2);
    expect(seriesFrom(pts, since).ctu.map((x) => x.v)).toEqual([90, 94]);
  });
  it("config: CTU has EIA-861 served count, region and time URLs; link-only utilities are never fetched", () => {
    const c = loadOutageConfig();
    const ctu = c.sources.find((s) => s.id === "ctu")!;
    expect(ctu.served).toBeGreaterThan(100000); expect(ctu.regionsUrl).toMatch(/^https:\/\//); expect(ctu.timeUrl).toMatch(/^https:\/\//);
    for (const s of c.sources.filter((x) => ["talquin", "duke-fl", "fpl"].includes(x.id))) { expect(s.type).toBe("link"); expect(s.url).toBeUndefined(); }
    expect(JSON.stringify(c.sources)).not.toMatch(/poweroutage\.us/);
    expect(compareUrlFor("12073", c.compare)).toMatch(/^https:\/\/poweroutage\.us\//);
    expect(compareUrlFor("48001", c.compare)).toBe("https://poweroutage.us/");
  });
});

describe("outage panel rules (web, pure)", () => {
  const rows = [row({ id: "ctu", name: "City utility", out: 94, outages: 39, served: 120220, pct: 0.08 }),
    row({ id: "talquin", name: "Co-op", kind: "link", out: null, outages: null, bbox: [-85.2, 30, -83.9, 30.75] }),
    row({ id: "far", name: "Far away", bbox: [-80, 25, -79, 26] })];
  const tlh = { lat: 30.44, lon: -84.28 };
  it("headline sums live feeds covering the place and lists the ones without a feed", () => {
    const h = headlineFor(rows, tlh, "Tallahassee")!;
    expect(h).toMatchObject({ out: 94, served: 120220, pct: 0.08, ids: ["ctu"], partial: ["Co-op"] });
  });
  it("headline says no feed when only link-only utilities cover a place", () => {
    const h = headlineFor(rows, { lat: 30.05, lon: -85.1 }, "Rural spot")!;
    expect(h.out).toBeNull(); expect(h.partial).toEqual(["Co-op"]);
    expect(headlineFor(rows, { lat: 40, lon: -100 }, "Nowhere")).toBeNull();
  });
  it("table: live first, then link-only; all utilities when no place", () => {
    expect(utilitiesFor(rows, tlh).map((r) => r.id)).toEqual(["ctu", "talquin"]);
    expect(utilitiesFor(rows, null)).toHaveLength(3);
  });
  it("one ramp: 0 / 10 / 30 / 60 / 100 %", () => {
    expect(outageColor(0)).toBeNull(); expect(outageColor(null)).toBeNull();
    expect(new Set([outageColor(0.5), outageColor(10), outageColor(30), outageColor(60), outageColor(100)]).size).toBe(5);
    expect(outageColor(9.99)).toBe(outageColor(0.01));
  });
  it("freshness text", () => {
    const now = Date.parse("2026-10-09T21:10:00Z");
    expect(minutesAgo("2026-10-09T21:07:00Z", now)).toBe("updated 3 min ago");
    expect(minutesAgo(null, now)).toBe("time unknown");
    expect(minutesAgo("2026-10-09T19:00:00Z", now)).toBe("updated 2 h 10 min ago");
  });
  it("sparkline + trend from our own snapshots", () => {
    const now = Date.parse("2026-10-09T21:00:00Z");
    const s = sumSeries({ ctu: [{ t: "2026-10-09T19:00:00Z", v: 200 }, { t: "2026-10-09T20:55:00Z", v: 90 }], other: [{ t: "2026-10-09T20:55:00Z", v: 10 }] }, ["ctu", "other"]);
    expect(s.map((x) => x.v)).toEqual([200, 100]);
    expect(sparkPoints(s, 240, 40, now).split(" ")).toHaveLength(2);
    expect(trend(s, now)).toMatchObject({ peak: 200, dir: "restoring", hourAgo: 200 });
  });
  it("compare link is link-only with a default", () => {
    expect(compareUrl("12073", { "12073": "https://poweroutage.us/area/county/321", default: "https://poweroutage.us/" })).toContain("/county/321");
    expect(compareUrl(null, {})).toBe("https://poweroutage.us/");
  });
});
