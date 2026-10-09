import { describe, expect, it } from "vitest";
import { dbzFromRgba, dbzWords, readRadarPixels, scanFor, radarPointUrl } from "../src/sources/radarPoint";
import rowsFile from "../../config/n0q-colors.json";
const rows = rowsFile.rows as [number, number, number, number, number][];
const color = (dbz: number) => rows.find((r) => r[1] === dbz)!;

describe("radar value under a tap", () => {
  it("color table round-trips to dBZ", () => {
    for (const d of [5, 20, 35, 47.5, 60]) { const r = color(d); expect(dbzFromRgba(r[2], r[3], r[4], 255, rows)).toBeCloseTo(d, 0); }
  });
  it("transparent = no echo", () => {
    expect(dbzFromRgba(0, 255, 0, 0, rows)).toBeNull();
  });
  it("words follow the usual reflectivity bands", () => {
    expect(dbzWords(null)).toBe("No rain on radar");
    expect(dbzWords(25)).toBe("Light rain");
    expect(dbzWords(45)).toBe("Heavy rain");
    expect(dbzWords(62)).toMatch(/hail/);
  });
  it("center pixel is 'here', the strongest pixel is 'nearby'", () => {
    const w = 5, h = 5, px = new Uint8Array(w * h * 4);
    const put = (x: number, y: number, d: number) => { const r = color(d), i = (y * w + x) * 4; px[i] = r[2]; px[i + 1] = r[3]; px[i + 2] = r[4]; px[i + 3] = 255; };
    put(2, 2, 30); put(0, 4, 50);
    const v = readRadarPixels(px, w, h, "2026-10-09T23:10:00.000Z", rows);
    expect(v.dbz).toBeCloseTo(30, 0); expect(v.words).toBe("Moderate rain");
    expect(v.nearbyMaxDbz).toBeCloseTo(50, 0); expect(v.scan).toBe("2026-10-09T23:10:00.000Z");
  });
  it("picks the latest scan when live, the 5-min scan in the past, none in the future", () => {
    const now = Date.parse("2026-10-09T23:20:00Z"), latest = "2026-10-09T23:15:00.000Z";
    expect(scanFor(now, now, latest)).toBe(latest);
    expect(scanFor(Date.parse("2026-10-09T22:47:00Z"), now, latest)).toBe("2026-10-09T22:45:00.000Z");
    expect(scanFor(now + 3.6e6, now, latest)).toBeNull();
  });
  it("asks IEM for a tiny box around the exact point at that scan", () => {
    const u = radarPointUrl(30.44, -84.28, "2026-10-09T23:10:00.000Z");
    expect(u).toContain("BBOX=-84.3300,30.3900,-84.2300,30.4900"); expect(u).toContain("TIME=2026-10-09T23:10:00Z"); expect(u).toContain("WIDTH=5");
  });
});
