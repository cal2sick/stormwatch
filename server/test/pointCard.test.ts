import { beforeEach, describe, expect, it } from "vitest";
import { alertsAt, clearPointCache, gridValueAt, parseValidTime, pointCard, pointKey, type Fetcher } from "../src/sources/pointCard";

const T = Date.parse("2026-10-09T23:30:00Z");
// Mock NWS/OSM: every value depends on the requested coordinates, so a card that ignored them would fail.
function mockFetch(calls: string[]): Fetcher {
  return async (url) => {
    calls.push(url);
    const m = /(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url) ?? /lat=(-?[\d.]+)&lon=(-?[\d.]+)/.exec(url);
    if (url.includes("/points/")) { const [, la, lo] = m!; return { properties: { forecastGridData: `https://api.weather.gov/gridpoints/X/${la},${lo}` } }; }
    if (url.includes("/gridpoints/")) {
      const [, la] = m!; const k = Math.round(Math.abs(Number(la)));
      return { properties: { updateTime: "2026-10-09T22:00:00+00:00",
        windSpeed: { uom: "wmoUnit:km_h-1", values: [{ validTime: "2026-10-09T22:00:00+00:00/PT3H", value: k * 2 }] },
        windDirection: { values: [{ validTime: "2026-10-09T22:00:00+00:00/PT3H", value: 180 }] },
        windGust: { uom: "wmoUnit:km_h-1", values: [{ validTime: "2026-10-09T22:00:00+00:00/PT3H", value: k * 3 }] },
        probabilityOfPrecipitation: { values: [{ validTime: "2026-10-09T22:00:00+00:00/PT6H", value: k }] },
        quantitativePrecipitation: { values: [{ validTime: "2026-10-09T18:00:00+00:00/PT6H", value: k }] } } };
    }
    if (url.includes("/alerts/")) return { features: Number(m![1]) > 30 ? [{ properties: { event: "Tornado Watch", onset: "2026-10-09T18:00:00Z", ends: "2026-10-10T01:00:00Z" } }] : [] };
    if (url.includes("nominatim")) return { address: { city: `City at ${m![1]}`, state: "Florida" } };
    throw new Error("unexpected " + url);
  };
}
const noOutages = async () => ({ radiusMi: 10, pollSeconds: 180, checked: "2026-10-09T23:00:00Z", outages: [], totalCustomers: 0, feeds: [], county: null, links: [], coverage: "none" as const, note: "" });

describe("tap card: data for the exact tapped point", () => {
  beforeEach(() => clearPointCache());
  it("two different points get different data, each fetched with its own coordinates", async () => {
    const calls: string[] = [];
    const tlh = await pointCard(30.4381, -84.2809, T, mockFetch(calls), noOutages);
    const mia = await pointCard(25.7617, -80.1918, T, mockFetch(calls), noOutages);
    expect(tlh.place.value).toContain("30.4381"); expect(mia.place.value).toContain("25.7617");
    expect(tlh.wind.value!.mph).not.toBe(mia.wind.value!.mph);
    expect(tlh.alerts.value!.map((a) => a.event)).toEqual(["Tornado Watch"]); expect(mia.alerts.value).toEqual([]);
    expect(calls.some((u) => u.includes("/points/30.4381,-84.2809"))).toBe(true);
    expect(calls.some((u) => u.includes("/points/25.7617,-80.1918"))).toBe(true);
    expect(calls.some((u) => u.includes("point=25.7617,-80.1918"))).toBe(true);
  });
  it("caches per 0.01 degree, not globally", async () => {
    const calls: string[] = [];
    await pointCard(30.4381, -84.2809, T, mockFetch(calls), noOutages);
    const n = calls.length;
    await pointCard(30.4382, -84.2810, T, mockFetch(calls), noOutages);
    expect(calls.length).toBe(n);
    await pointCard(30.4581, -84.2809, T, mockFetch(calls), noOutages);
    expect(calls.length).toBeGreaterThan(n);
    expect(pointKey(30.4381, -84.2809)).toBe("30.44,-84.28");
  });
  it("values follow the chosen time; outside the forecast it says unavailable instead of guessing", async () => {
    const late = await pointCard(30.4381, -84.2809, Date.parse("2026-10-11T12:00:00Z"), mockFetch([]), noOutages);
    expect(late.wind.value).toBeNull(); expect(late.wind.note).toMatch(/No NWS forecast/);
    expect(late.alerts.value).toEqual([]); // the watch has ended by then
  });
  it("offshore / NWS error -> unavailable with a note, never another point's data", async () => {
    const f: Fetcher = async (u) => { if (u.includes("weather.gov")) throw new Error("HTTP 404"); return {}; };
    const c = await pointCard(27, -88, T, f, noOutages);
    expect(c.wind.value).toBeNull(); expect(c.wind.note).toMatch(/offshore|outside/); expect(c.alerts.value).toBeNull();
  });
  it("parses gridpoint times and alert windows", () => {
    expect(parseValidTime("2026-10-09T22:00:00+00:00/P1DT2H")).toEqual([Date.parse("2026-10-09T22:00:00Z"), Date.parse("2026-10-11T00:00:00Z")]);
    expect(gridValueAt({ values: [{ validTime: "2026-10-09T22:00:00+00:00/PT1H", value: 5 }] }, T)).toBeNull();
    expect(alertsAt([{ properties: { event: "A", onset: "2026-10-10T00:00:00Z", ends: "2026-10-10T02:00:00Z" } }], T)).toEqual([]);
  });
});

// Live check against real NWS / OSM (opt-in: LIVE=1 npx vitest run test/pointCard.test.ts).
describe.skipIf(!process.env.LIVE)("tap card live: Tallahassee vs Pensacola vs Miami", () => {
  it("returns different place names and NWS data per city", async () => {
    clearPointCache();
    const pts = [[30.4381, -84.2809], [30.4213, -87.2169], [25.7617, -80.1918]];
    const cards = await Promise.all(pts.map(([a, o]) => pointCard(a, o, Date.now(), undefined, async () => { throw new Error("skip outages"); })));
    for (const c of cards) console.log(c.key, c.place.value, c.wind.value, c.gust.value, c.rainChance.value, c.alerts.value?.map((a) => a.event));
    expect(new Set(cards.map((c) => c.place.value)).size).toBe(3);
    expect(cards.every((c) => c.wind.value != null)).toBe(true);
  }, 60_000);
});
