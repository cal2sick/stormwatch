import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { needsPan, radarForTime, RADAR_FUTURE_NOTE, stormLabel } from "../../web/src/map/sliderView";
import { stateAt, type TrackPoint } from "../../web/src/track";
import { parseLandmarks } from "../src/config.js";

const T0 = Date.parse("2026-10-09T15:00:00Z");
const H = 3.6e6;
const track: TrackPoint[] = [
  { time: T0 - 6 * H, lat: 26.5, lon: -87.0, windKt: 90, source: "NHC past track" },
  { time: T0, lat: 27.6, lon: -87.4, windKt: 90, tau: 0, source: "NHC forecast" },
  { time: T0 + 12 * H, lat: 29.6, lon: -87.3, windKt: 85, tau: 12, source: "NHC forecast" },
  { time: T0 + 24 * H, lat: 31.8, lon: -86.9, windKt: 45, tau: 24, source: "NHC forecast" },
];
const home = { lat: 30, lon: -84 };

describe("main storm marker follows the slider", () => {
  it("position changes with the selected time (past, now, forecast)", () => {
    const pts = [T0 - 3 * H, T0, T0 + 6 * H, T0 + 18 * H].map((t) => stateAt(track, t, home)!);
    for (let i = 1; i < pts.length; i++) expect(pts[i].lat).toBeGreaterThan(pts[i - 1].lat);
    expect(pts[2].lat).toBeCloseTo(28.6, 1);
  });
  it("label has the selected time, wind in mph and the category, never knots", () => {
    const s = stateAt(track, T0 + 14 * H, home)!;
    const l = stormLabel("Isaias", s.time, s.windMph, s.category, false);
    expect(l).toMatch(/^Isaias · Sat 1:00 AM ET · \d+ mph · Cat \d$/);
    expect(l).not.toMatch(/kt|KT/);
    expect(stormLabel("Isaias", T0, 105, "Cat 2", true)).toContain("Now, ");
  });
});

describe("radar follows the slider", () => {
  const frames = Array.from({ length: 13 }, (_, i) => ({ time: new Date(T0 - (12 - i) * 600_000).toISOString(), path: `/v2/radar/${i}` }));
  it("live = animated loop", () => expect(radarForTime(frames, T0, T0, true).mode).toBe("live"));
  it("past within history = closest frame", () => {
    const p = radarForTime(frames, T0 - 47 * 60_000, T0, false);
    expect(p.mode).toBe("past"); expect(p.index).toBe(7); // frame at T0-50min is closest to T0-47min
  });
  it("past beyond history = no radar, with a note", () => expect(radarForTime(frames, T0 - 5 * H, T0, false).mode).toBe("past-none"));
  it("future = no radar and a clear note", () => {
    const p = radarForTime(frames, T0 + 3 * H, T0, false);
    expect(p.mode).toBe("future"); expect(p.index).toBe(-1); expect(p.note).toBe(RADAR_FUTURE_NOTE);
  });
});

describe("map pans only when the storm leaves the central 70%", () => {
  it("inside: no pan", () => { expect(needsPan(500, 400, 1000, 800)).toBe(false); expect(needsPan(160, 130, 1000, 800)).toBe(false); });
  it("outside: pan", () => { expect(needsPan(140, 400, 1000, 800)).toBe(true); expect(needsPan(500, 790, 1000, 800)).toBe(true); });
});

describe("landmarks", () => {
  it("config/landmarks.json has FSU, Collegetown and Tallahassee with valid coordinates", () => {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "../../config/landmarks.json"), "utf8"));
    const lm = parseLandmarks(raw);
    const names = lm.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(["Florida State University", "Collegetown", "Tallahassee"]));
    for (const l of lm) { expect(l.lat).toBeGreaterThan(30.4); expect(l.lat).toBeLessThan(30.5); expect(l.lon).toBeGreaterThan(-84.35); expect(l.lon).toBeLessThan(-84.25); }
  });
  it("bad entries are dropped", () => {
    expect(parseLandmarks({ landmarks: [{ name: "x", lat: 200, lon: 0 }, { lat: 1, lon: 1 }, { name: "ok", lat: 1, lon: 2 }] })).toEqual([{ name: "ok", lat: 1, lon: 2, kind: "place" }]);
    expect(parseLandmarks(null)).toEqual([]);
  });
});
