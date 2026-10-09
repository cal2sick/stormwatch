import { describe as d, expect, it } from "vitest";
import { stateAt, closestApproach, gcInterp, describe as describeState, type TrackPoint } from "../../web/src/track";

const H = 3.6e6, t0 = Date.UTC(2026, 9, 9, 15);
// Example forecast points shaped like an NHC advisory (fixture).
const track: TrackPoint[] = [
  { time: t0, lat: 28.4, lon: -87.2, windKt: 105, tau: 0, source: "NHC" },
  { time: t0 + 9 * H, lat: 29.7, lon: -86.8, windKt: 100, tau: 12, source: "NHC" },
  { time: t0 + 21 * H, lat: 32.1, lon: -87.1, windKt: 55, tau: 24, source: "NHC" },
  { time: t0 + 33 * H, lat: 34.2, lon: -87.2, windKt: 35, tau: 36, source: "NHC" },
];
const home = { lat: 30.0, lon: -84.0 }; // arbitrary test point

d("track interpolation", () => {
  it("returns NHC values exactly at forecast times", () => {
    for (const p of track) {
      const s = stateAt(track, p.time, home)!;
      expect(s.lat).toBeCloseTo(p.lat, 6); expect(s.lon).toBeCloseTo(p.lon, 6); expect(s.windKt).toBeCloseTo(p.windKt!, 6);
      expect(s.exact).toBe(p); expect(s.outOfRange).toBeNull();
    }
  });
  it("interpolates halfway between points", () => {
    const s = stateAt(track, t0 + 15 * H, home)!; // halfway 12h..24h
    expect(s.frac).toBeCloseTo(0.5, 9);
    expect(s.windKt).toBeCloseTo(77.5, 6);
    expect(s.lat).toBeCloseTo(30.9, 1); expect(s.lon).toBeCloseTo(-86.95, 1);
    expect(s.category).toBe("Cat 1");
    expect(s.headingCardinal).toMatch(/N/);
  });
  it("great-circle midpoint on the equator is exact", () => {
    const [la, lo] = gcInterp(0, 0, 0, 10, 0.5); expect(la).toBeCloseTo(0, 9); expect(lo).toBeCloseTo(5, 9);
  });
  it("flags times outside the forecast", () => {
    expect(stateAt(track, t0 - H, home)!.outOfRange).toBe("before");
    expect(stateAt(track, t0 + 40 * H, home)!.outOfRange).toBe("after");
  });
  it("closest approach is within the track window and not farther than any point", () => {
    const c = closestApproach(track, home)!;
    for (const p of track) expect(c.distanceMi).toBeLessThanOrEqual(stateAt(track, p.time, home)!.distanceMi + 1e-6);
  });
  it("describes in plain English", () => {
    const txt = describeState(stateAt(track, t0 + 15 * H, home)!, "Example", "012");
    expect(txt).toMatch(/interpolated 50% between 12h forecast point and 24h forecast point/);
  });
});
