import { describe, expect, it } from "vitest";
import { arrivalFromIsochrones, bearingDeg, categoryFromKt, distanceMi, motionCpa, pointInGeometry, trackCpa } from "../src/geo.js";

describe("distanceMi (haversine)", () => {
  // Reference values from the spherical law of cosines (independent formula), R = 3958.7613 mi.
  const ref = (a: number, b: number, c: number, d: number) => {
    const r = (x: number) => (x * Math.PI) / 180;
    return 3958.7613 * Math.acos(Math.sin(r(a)) * Math.sin(r(c)) + Math.cos(r(a)) * Math.cos(r(c)) * Math.cos(r(d - b)));
  };
  const cases: [number, number, number, number][] = [
    [30.0, -84.0, 27.9, -87.2],         // test point -> central Gulf
    [29.9511, -90.0715, 25.7617, -80.1918], // New Orleans -> Miami
    [25.7617, -80.1918, 29.7604, -95.3698], // Miami -> Houston
  ];
  for (const c of cases) it(`within 1% for ${c.join(",")}`, () => {
    expect(Math.abs(distanceMi(...c) - ref(...c)) / ref(...c)).toBeLessThan(0.01);
  });
  it("Miami to Houston is ~ 970 mi", () => { const d = distanceMi(25.7617, -80.1918, 29.7604, -95.3698); expect(d).toBeGreaterThan(940); expect(d).toBeLessThan(1000); });
});

describe("bearing / category", () => {
  it("due north is 0", () => expect(bearingDeg(30, -84, 31, -84)).toBeCloseTo(0, 5));
  it("due east is ~90", () => expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5));
  it("categories from kt", () => {
    expect(categoryFromKt(105)).toBe("CAT 3"); expect(categoryFromKt(64)).toBe("CAT 1");
    expect(categoryFromKt(40)).toBe("TS"); expect(categoryFromKt(null)).toBe("—");
  });
});

describe("pointInGeometry", () => {
  const sq: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[-85, 29], [-83, 29], [-83, 31], [-85, 31], [-85, 29]]] };
  it("inside", () => expect(pointInGeometry(-84.0, 30.0, sq)).toBe(true));
  it("outside", () => expect(pointInGeometry(-86, 30.0, sq)).toBe(false));
});

describe("closest approach", () => {
  it("motion CPA: storm due south moving north passes over home", () => {
    const r = motionCpa({ lat: 30, lon: -84 }, { lat: 28, lon: -84, dirDeg: 0, speedMph: 10, time: "2026-01-01T00:00:00Z" });
    expect(r.distanceMi).toBeLessThan(1);
    expect(Date.parse(r.time!)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
  });
  it("motion CPA: moving away is receding", () => {
    expect(motionCpa({ lat: 30, lon: -84 }, { lat: 28, lon: -84, dirDeg: 180, speedMph: 10, time: null }).receding).toBe(true);
  });
  it("track CPA finds the nearest interpolated point", () => {
    const r = trackCpa({ lat: 30, lon: -84 }, [
      { lat: 28, lon: -85, time: "2026-01-01T00:00:00Z" }, { lat: 32, lon: -85, time: "2026-01-01T12:00:00Z" },
    ])!;
    expect(r.distanceMi).toBeGreaterThan(55); expect(r.distanceMi).toBeLessThan(65); // ~1° lon at 30N ≈ 59.8 mi
    expect(r.time).toBe("2026-01-01T06:00:00.000Z");
  });
});

describe("arrivalFromIsochrones", () => {
  // Storm at origin, home 100 mi north-ish; straight isochrones moving north.
  const s = { lat: 28, lon: -84 }, h = { lat: 29.45, lon: -84 };
  const line = (lat: number) => [[-85, lat], [-83, lat]];
  it("interpolates between bracketing isochrones", () => {
    const r = arrivalFromIsochrones(s, h, [
      { time: "2026-01-01T00:00:00Z", line: line(29.0) }, { time: "2026-01-01T06:00:00Z", line: line(29.9) },
    ])!;
    expect(r.bound).toBe("at");
    expect(Date.parse(r.time)).toBeCloseTo(Date.parse("2026-01-01T03:00:00Z"), -5);
  });
  it("before the first isochrone when home is already inside it", () => {
    expect(arrivalFromIsochrones(s, h, [{ time: "2026-01-01T00:00:00Z", line: line(30) }])!.bound).toBe("before");
  });
  it("null when the field never reaches home", () => {
    expect(arrivalFromIsochrones(s, { lat: 40, lon: -84 }, [{ time: "2026-01-01T00:00:00Z", line: line(29) }])).toBeNull();
  });
});
