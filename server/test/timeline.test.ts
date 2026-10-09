import { describe, expect, it } from "vitest";
import { stateAt, type TrackPoint } from "../../web/src/track";
import { adviceFor, adviceWindows, alertsActiveAt, coneRadiusMi, hourAt, pathBetween } from "../../web/src/timeline";

const H = 3.6e6, t0 = Date.UTC(2026, 9, 9, 15);
const track: TrackPoint[] = [
  { time: t0, lat: 28.4, lon: -87.2, windKt: 105, tau: 0, source: "NHC" },
  { time: t0 + 9 * H, lat: 29.7, lon: -86.8, windKt: 100, tau: 12, source: "NHC" },
  { time: t0 + 21 * H, lat: 32.1, lon: -87.1, windKt: 60, tau: 24, source: "NHC" },
];
const home = { lat: 30.0, lon: -84.0 }; // arbitrary test point

describe("slider time moves the storm", () => {
  it("positions differ for different times", () => {
    const a = stateAt(track, t0 + 1 * H, home)!, b = stateAt(track, t0 + 6 * H, home)!, c = stateAt(track, t0 + 15 * H, home)!;
    expect(a.lat).not.toBeCloseTo(b.lat, 3); expect(b.lat).not.toBeCloseTo(c.lat, 3);
    expect(c.lat).toBeGreaterThan(b.lat); expect(b.lat).toBeGreaterThan(a.lat);
  });
  it("trail from now to t ends at the interpolated position", () => {
    const t = t0 + 15 * H, s = stateAt(track, t, home)!;
    const p = pathBetween(track, t0, t);
    expect(p.length).toBe(3); // start, 12h point, end
    expect(p[p.length - 1][0]).toBeCloseTo(s.lon, 6); expect(p[p.length - 1][1]).toBeCloseTo(s.lat, 6);
    expect(pathBetween(track, t0, t0 + 2 * H).length).toBe(2);
  });
  it("cone size grows with time", () => { expect(coneRadiusMi(24)).toBeGreaterThan(coneRadiusMi(12)); expect(coneRadiusMi(0)).toBe(0); });
});

describe("time-based warnings", () => {
  const al = (event: string, onset: string, ends: string | null, expires: string) => ({ id: event, event, severity: "", urgency: "", certainty: "", headline: null, description: "", instruction: null, onset, ends, expires, sent: onset, senderName: null });
  const alerts = [al("Flood Watch", "2026-10-09T14:00:00-04:00", "2026-10-10T20:00:00-04:00", "2026-10-09T18:00:00-04:00"), al("Tornado Watch", "2026-10-09T13:28:00-04:00", "2026-10-09T21:00:00-04:00", "2026-10-09T21:00:00-04:00")];
  it("filters by onset and end", () => {
    expect(alertsActiveAt(alerts, Date.parse("2026-10-09T13:00:00-04:00")).length).toBe(0);
    expect(alertsActiveAt(alerts, Date.parse("2026-10-09T15:00:00-04:00")).map((a) => a.event)).toEqual(["Flood Watch", "Tornado Watch"]);
    expect(alertsActiveAt(alerts, Date.parse("2026-10-10T08:00:00-04:00")).map((a) => a.event)).toEqual(["Flood Watch"]);
  });
  const hourly = Array.from({ length: 12 }, (_, i) => ({ time: new Date(Date.parse("2026-10-09T18:00:00-04:00") + i * H).toISOString(), tempF: 70, windMph: 20 + i, gustMph: 30 + i * 2, windDir: "E", pop: 70, shortForecast: "" }));
  it("hourAt finds the hour", () => { expect(hourAt(hourly, Date.parse("2026-10-09T19:30:00-04:00"))?.gustMph).toBe(32); });
  it("advice uses real numbers and plain words", () => {
    const a = adviceFor(hourly.slice(0, 6))!;
    expect(a.maxGustMph).toBe(40); expect(a.level).toBe("strong"); expect(a.text).toMatch(/Strongest gusts about 40 mph/);
    const w = adviceWindows(hourly, Date.parse("2026-10-09T18:00:00-04:00"), Date.parse("2026-10-10T06:00:00-04:00"));
    expect(w.length).toBe(2); // 6pm-midnight, midnight-6am ET
  });
});

import { fullTrack, magnets, snapTime } from "../../web/src/timeline";
describe("past / now / future on one track", () => {
  const past: TrackPoint[] = [
    { time: t0 - 24 * H, lat: 25.0, lon: -88.0, windKt: 70, tau: null, source: "NHC past track" },
    { time: t0 - 12 * H, lat: 26.6, lon: -87.7, windKt: 90, tau: null, source: "NHC past track" },
  ];
  const live = { lat: 28.6, lon: -87.1, lastUpdate: new Date(t0 + 3 * H).toISOString(), intensityKt: 105 };
  const all = fullTrack(past, track, live);
  it("merges past, live and forecast in time order", () => {
    expect(all.map((p) => p.source)).toEqual(["NHC past track", "NHC past track", "NHC", expect.stringMatching(/latest NHC position/), "NHC", "NHC"]);
  });
  it("past, now and future positions are different and in order", () => {
    const pastS = stateAt(all, t0 - 18 * H, home)!, nowS = stateAt(all, t0 + 3 * H, home)!, fut = stateAt(all, t0 + 15 * H, home)!;
    expect(nowS.lat).toBeCloseTo(28.6, 6); expect(nowS.lon).toBeCloseTo(-87.1, 6); // exactly the latest NHC position
    expect(pastS.lat).toBeLessThan(nowS.lat); expect(fut.lat).toBeGreaterThan(nowS.lat);
    expect(pastS.lat).toBeGreaterThan(25.0); expect(pastS.lat).toBeLessThan(26.6);
  });
  it("slider snaps to 15 minutes and sticks to NHC hours and now", () => {
    const now = t0 + 3 * H + 7 * 60_000, m = magnets(all, now);
    expect(snapTime(now + 10 * 60_000, m)).toBe(now);
    expect(snapTime(t0 + 9 * H - 20 * 60_000, m)).toBe(t0 + 9 * H);
    expect(snapTime(t0 + 6 * H + 8 * 60_000, m) % (15 * 60_000)).toBe(0);
  });
});
