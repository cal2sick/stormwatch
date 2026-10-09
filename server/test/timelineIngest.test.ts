// Replay tests: NHC archive JSON + ATCF archive decks for a past storm (Idalia, al102023), and the TCM parser.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atcfLatLon, dtgToIso, ofclByBase, parseDeck } from "../src/sources/atcf";
import { isIntermediate, normAdv, parseTcm } from "../src/sources/tcm";
import { liveFix, listAdvisories, loadAdvisory, ofclRecords, saveAdvisory } from "../src/advisories";
import { coneCircleAt, quadRing, radiiAt, sliderRange, timelineTrack } from "../../web/src/stormTime";
import { stateAt } from "../../web/src/track";
import { coneRadiusNm } from "../../web/src/timeline";
import type { StormTimeline } from "../src/types";

const fx = (f: string) => readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const best = parseDeck(fx("bal102023.dat"), "BEST");
const ofcl = parseDeck(fx("aal102023-ofcl.dat"), "OFCL");
const arch = JSON.parse(fx("CurrentStorms_2023-08-29-2036.json")).activeStorms[0];
const strip = ({ baseUTC: _b, ...f }: any) => f;
const home = { lat: 30.69, lon: -88.04 }; // an arbitrary public point (downtown Mobile, AL)

describe("ATCF decks", () => {
  it("parses lat/lon tenths and DTG", () => {
    expect(atcfLatLon("270N")).toBe(27); expect(atcfLatLon("876W")).toBeCloseTo(-87.6); expect(atcfLatLon("123S")).toBeCloseTo(-12.3);
    expect(dtgToIso("2023083012")).toBe("2023-08-30T12:00:00.000Z");
  });
  it("merges 34/50/64-kt rows into one fix per time", () => {
    const f = best.find((b) => b.validUTC === "2023-08-30T12:00:00.000Z")!;
    expect(f).toBeTruthy();
    expect(f.r34).not.toBeNull(); expect(new Set(best.map((b) => b.validUTC)).size).toBe(best.length);
  });
  it("groups OFCL by synoptic time with taus", () => {
    const g = ofclByBase(ofcl);
    expect([...g.keys()]).toEqual(["2023-08-29T00:00:00.000Z", "2023-08-29T18:00:00.000Z"]);
    const a = g.get("2023-08-29T18:00:00.000Z")!;
    expect(a.map((p) => p.tau).slice(0, 4)).toEqual([0, 3, 12, 24]);
    expect(a[2].validUTC).toBe("2023-08-30T06:00:00.000Z");
    expect(a[2].r64).toEqual([25, 25, 15, 15]);
  });
});

describe("TCM text", () => {
  const p = parseTcm(fx("tcm-al092026-12.txt"))!;
  it("reads advisory number, id, taus from the synoptic time, and radii", () => {
    expect(p.advNum).toBe("12"); expect(p.stormId).toBe("al092026");
    expect(p.issuedUTC).toBe("2026-10-09T15:00:00.000Z");
    expect(p.points[0]).toMatchObject({ tau: 3, lat: 27.7, lon: -87.3, vmaxKt: 105, mslp: 959, r34: [180, 110, 80, 160], r64: [30, 30, 20, 20] });
    expect(p.points[1]).toMatchObject({ validUTC: "2026-10-10T00:00:00.000Z", tau: 12, vmaxKt: 100, r50: [50, 50, 30, 50] });
    expect(p.points.at(-1)!.tau).toBe(60);
  });
  it("tells full from intermediate advisories", () => {
    expect(isIntermediate("012a")).toBe(true); expect(isIntermediate("12")).toBe(false); expect(normAdv("012a")).toBe("12A");
  });
});

describe("advisory store is write-once", () => {
  it("never overwrites a stored advisory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sw-adv-"));
    try {
      const [r] = ofclRecords("al102023", ofcl);
      expect(saveAdvisory(r, dir)).toBe(true);
      expect(saveAdvisory({ ...r, points: [] }, dir)).toBe(false);
      expect(loadAdvisory("al102023", r.advNum, dir)!.points.length).toBe(r.points.length);
      expect(listAdvisories("al102023", dir)).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("Idalia replay (al102023): slider on one UTC timeline", () => {
  const recs = ofclRecords("al102023", ofcl);
  const adv = recs.find((r) => r.synopticUTC === "2023-08-29T18:00:00.000Z")!;
  const tl: StormTimeline = { stormId: "al102023", name: "Idalia", best: best.map(strip), live: liveFix(arch), latest: adv, advisories: [], updated: "" };

  it("past-only track hits every best-track fix exactly (0.01°)", () => {
    const track = timelineTrack({ ...tl, live: null }, null, false);
    for (const b of best) {
      const s = stateAt(track, Date.parse(b.validUTC), home)!;
      expect(Math.abs(s.lat - b.lat)).toBeLessThan(0.01);
      expect(Math.abs(s.lon - b.lon)).toBeLessThan(0.01);
      expect(s.windKt).toBe(b.vmaxKt);
    }
  });
  it("with the 18Z advisory: best track before the live point, then the official forecast", () => {
    const track = timelineTrack(tl, adv, true);
    const liveT = Date.parse(arch.lastUpdate);
    for (const b of best.filter((b) => Date.parse(b.validUTC) <= liveT)) {
      const s = stateAt(track, Date.parse(b.validUTC), home)!;
      expect(Math.abs(s.lat - b.lat)).toBeLessThan(0.01); expect(Math.abs(s.lon - b.lon)).toBeLessThan(0.01);
    }
    const f12 = adv.points.find((p) => p.tau === 12)!;
    const s12 = stateAt(track, Date.parse(f12.validUTC), home)!;
    expect(s12.lat).toBeCloseTo(f12.lat, 2); expect(s12.lon).toBeCloseTo(f12.lon, 2);
    // halfway between two forecast points is between them (great circle), intensity linear
    const f24 = adv.points.find((p) => p.tau === 24)!;
    const mid = stateAt(track, (Date.parse(f12.validUTC) + Date.parse(f24.validUTC)) / 2, home)!;
    expect(mid.lat).toBeGreaterThan(f12.lat); expect(mid.lat).toBeLessThan(f24.lat);
    expect(mid.windKt).toBeCloseTo((f12.vmaxKt! + f24.vmaxKt!) / 2, 5);
  });
  it("selecting an older advisory swaps the forecast, keyed by valid time (not index)", () => {
    const old = recs.find((r) => r.synopticUTC === "2023-08-29T00:00:00.000Z")!;
    const track = timelineTrack(tl, old, false);
    const p = old.points.find((x) => x.tau === 24)!;
    const s = stateAt(track, Date.parse(p.validUTC), home)!;
    expect(s.lat).toBeCloseTo(p.lat, 2); expect(s.lon).toBeCloseTo(p.lon, 2);
  });
  it("wind radii are linear in time; cone circle uses the 2026 table by tau", () => {
    const track = timelineTrack(tl, adv, true);
    const f12 = adv.points.find((p) => p.tau === 12)!, f24 = adv.points.find((p) => p.tau === 24)!;
    const r = radiiAt(track, (Date.parse(f12.validUTC) + Date.parse(f24.validUTC)) / 2);
    expect(r.r34![0]).toBeCloseTo((f12.r34![0] + f24.r34![0]) / 2, 5);
    expect(coneRadiusNm(12)).toBe(25); expect(coneRadiusNm(18)).toBe(32); expect(coneRadiusNm(120)).toBe(200);
    const c = coneCircleAt(adv, "al102023", Date.parse(f24.validUTC))!;
    expect(c.tau).toBe(24); expect(c.radiusMi).toBeCloseTo(39 * 1.15078, 3);
    expect(coneCircleAt(adv, "al102023", Date.parse("2023-08-29T12:00:00Z"))).toBeNull();
    const ring = quadRing(-84, 29, [60, 30, 20, 40]);
    expect(ring[0][1]).toBeCloseTo(29 + (60 * 1.852) / 111.2, 4); expect(ring.at(-1)).toEqual(ring[0]);
  });
  it("slider range spans valid times, not issue times", () => {
    const track = timelineTrack(tl, adv, true);
    const now = Date.parse(arch.lastUpdate);
    const [a, b] = sliderRange(track, now);
    expect(b).toBe(Date.parse(adv.points.at(-1)!.validUTC));
    expect(a).toBe(Math.max(Date.parse(best[0].validUTC), now - 72 * 3.6e6));
  });
});
