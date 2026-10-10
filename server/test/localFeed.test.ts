import { describe, expect, it } from "vitest";
import { describeObs, parseAlerts, parseLsr, productHeadline } from "../src/sources/localFeed";
import { mergeFeed } from "../../web/src/hud/LocalFeed";

const P = { lat: 30.44, lon: -84.28 }; // public city coordinates (Tallahassee city hall area)

describe("local feed", () => {
  it("HLS headline is taken verbatim", () => {
    const t = "000\nWTUS82 KTAE 091528\nHLSTAE\n\nHurricane Isaias Local Statement Advisory Number 13\n\n...ALL TROPICAL WATCHES HAVE BEEN\nUPGRADED TO WARNINGS...\n\n.NEW INFORMATION...\n";
    expect(productHeadline(t)).toBe("...ALL TROPICAL WATCHES HAVE BEEN UPGRADED TO WARNINGS...");
  });
  it("observation in plain English with pressure trend", () => {
    const s = describeObs({ windSpeed: { value: 32.2 }, windGust: { value: 64.4 }, windDirection: { value: 90 }, barometricPressure: { value: 100800 }, textDescription: "Heavy Rain" },
      { barometricPressure: { value: 101000 } });
    expect(s).toBe("Wind from the E 20 mph, gusts 40 mph, pressure 29.77 inches (falling 0.06 in the last hour), heavy rain.");
  });
  it("storm reports: own office or nearby, newest first", () => {
    const fc = { features: [
      { properties: { wfo: "TAE", valid: "2026-10-09T18:06:00Z", typetext: "TSTM WND DMG", city: "Odena", st: "FL", remark: "Trees down.", product_id: "x1" }, geometry: { coordinates: [-85.6, 30.3] } },
      { properties: { wfo: "JAX", valid: "2026-10-09T19:00:00Z", typetext: "NON-TSTM WND GST", magnitude: "40", unit: "MPH", city: "Mayport", st: "FL", remark: "Gust." }, geometry: { coordinates: [-81.43, 30.4] } },
      { properties: { wfo: "TAE", valid: "2026-10-09T20:00:00Z", typetext: "FLOOD", city: "Midtown", st: "FL", remark: "Street flooding." }, geometry: { coordinates: [-84.27, 30.46] } },
    ] };
    const r = parseLsr(fc, P, "TAE");
    expect(r.map((i) => i.text)).toEqual(["Street flooding.", "Trees down."]);
    expect(r[0].title).toMatch(/Flood, Midtown, FL \(\d+ miles away\)/);
  });
  it("alerts: updates are marked, headline verbatim", () => {
    const r = parseAlerts({ features: [{ id: "a", properties: { id: "a", sent: "2026-10-09T21:17:00Z", event: "Flood Watch", messageType: "Update", headline: "Flood Watch issued October 9", senderName: "NWS Tallahassee FL" } }] }, P);
    expect(r[0].title).toBe("Updated: Flood Watch"); expect(r[0].text).toBe("Flood Watch issued October 9");
  });
  it("merge is newest first and unique", () => {
    const a = { id: "1", time: "2026-10-09T20:00:00Z", kind: "alert" as const, title: "", text: "", url: null, source: "" };
    const b = { ...a, id: "2", time: "2026-10-09T21:00:00Z" };
    expect(mergeFeed([a, b], [a]).map((i) => i.id)).toEqual(["2", "1"]);
  });
});

import { lsrPlace, obsTrends, productSummary } from "../src/sources/localFeed";
describe("v0.7.1 richer live feed", () => {
  it("statement summary is short sentence case; the headline stays available verbatim", () => {
    const t = "000\nWTUS82 KTAE 092300\nHLSTAE\n\n...TROPICAL STORM WARNING REMAINS IN EFFECT FOR LEON COUNTY...\n\nNEW INFORMATION\nmore text";
    const s = productSummary(t);
    expect(s).toBe("Tropical storm warning remains in effect for Leon County.");
    expect(productHeadline(t)).toBe("...TROPICAL STORM WARNING REMAINS IN EFFECT FOR LEON COUNTY...");
  });
  it("storm report places read like '2 mi north-northwest of Town'", () => {
    expect(lsrPlace("2 NNW Midtown")).toBe("2 mi north-northwest of Midtown");
    expect(lsrPlace("Midtown")).toBe("Midtown");
  });
  it("observation trends: peak gust in 12 h and 3-hour pressure change", () => {
    const t0 = Date.parse("2026-10-09T23:00:00Z");
    const at = (h: number) => new Date(t0 - h * 3.6e6).toISOString();
    const list = [
      { timestamp: at(0), windGust: { value: 48.3 }, barometricPressure: { value: 100000 } },
      { timestamp: at(1), windGust: { value: 64.4 }, barometricPressure: { value: 100200 } },
      { timestamp: at(3), windGust: { value: null }, barometricPressure: { value: 100500 } },
    ];
    const s = obsTrends(list, t0);
    expect(s).toMatch(/Peak gust in the last 12 hours: 40 mph at 6:00 PM ET/);
    expect(s).toMatch(/Pressure falling 0\.15 inches over 3 hours/);
  });
});
