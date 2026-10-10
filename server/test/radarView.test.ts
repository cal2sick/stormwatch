import { describe, expect, it } from "vitest";
import { hrrrRadarUrl, iemRadarUrl, phaseAt, radarViewAt, type ForecastRadar } from "../../web/src/map/sliderView";
import { snapTime } from "../../web/src/timeline";
import { forecastMinuteFor } from "../src/sources/hrrr";

const NOW = Date.parse("2026-10-09T21:20:00Z"), M = 60_000;
const LATEST = "2026-10-09T21:10:00.000Z";
const FC: ForecastRadar = { source: "HRRR", initTime: "2026-10-09T19:00:00.000Z", steps: [30, 60, 90, 120, 180].map((l) => ({
  leadMin: l, fMinute: 140 + l, validTime: new Date(NOW + l * M).toISOString(), initTime: "2026-10-09T19:00:00.000Z" })) };

describe("radar view at the slider time (v0.5 fix: never blank 10 min from now)", () => {
  it("live = latest scan", () => {
    const v = radarViewAt(NOW, NOW, true, LATEST, FC);
    expect(v.kind).toBe("observed"); if (v.kind === "observed") { expect(v.latest).toBe(true); expect(v.url).toContain("USCOMP-N0Q-202610092110/"); }
  });
  it("10 minutes back = the 5-minute archived scan, labeled with its time", () => {
    const v = radarViewAt(NOW - 17 * M, NOW, false, LATEST, FC);
    expect(v.kind).toBe("observed");
    if (v.kind === "observed") { expect(v.url).toBe(iemRadarUrl("202610092100")); expect(v.label).toMatch(/^Radar at .*5:00 PM ET/); expect(v.latest).toBe(false); }
  });
  it("between the newest scan and now = newest scan (never a not-yet-existing tile)", () => {
    const v = radarViewAt(NOW - 4 * M, NOW, false, LATEST, FC);
    expect(v.kind === "observed" && v.url).toBe(iemRadarUrl("202610092110"));
  });
  it("10 minutes forward = forecast radar (HRRR), labeled forecast with model run", () => {
    const v = radarViewAt(NOW + 10 * M, NOW, false, LATEST, FC);
    expect(v.kind).toBe("forecast");
    if (v.kind === "forecast") { expect(v.url).toBe(hrrrRadarUrl(FC.initTime, 170)); expect(v.url).toContain("hrrr::REFD-F0170-202610091900/"); expect(v.label).toMatch(/FORECAST.*not real radar.*HRRR.*may be wrong|FORECAST.*HRRR.*may be wrong/); }
  });
  it("+3 h picks the +180 step; beyond 3 h hides radar with a reason", () => {
    const v = radarViewAt(NOW + 175 * M, NOW, false, LATEST, FC); expect(v.kind === "forecast" && v.leadMin).toBe(180);
    const w = radarViewAt(NOW + 5 * 60 * M, NOW, false, LATEST, FC); expect(w.kind === "none" && w.reason).toBe("beyond-forecast");
  });
  it("future without model data = clear unavailable state, not old radar", () => {
    const v = radarViewAt(NOW + 30 * M, NOW, false, LATEST, null); expect(v.kind === "none" && v.reason).toBe("forecast-unavailable");
  });
  it("phase", () => { expect(phaseAt(NOW, NOW, true)).toBe("live"); expect(phaseAt(NOW - 10 * M, NOW, false)).toBe("past"); expect(phaseAt(NOW + 10 * M, NOW, false)).toBe("forecast"); });
});

describe("slider near now uses 5-minute steps (v0.4 snapped +-40 min back to live)", () => {
  const mags = [NOW, NOW + 3 * 3.6e6];
  it("10 min back / forward stays there", () => {
    expect(snapTime(NOW - 10 * M - 40_000, mags, 15 * M, 40 * M, NOW)).toBe(NOW - 10 * M);
    expect(snapTime(NOW + 10 * M + 50_000, mags, 15 * M, 40 * M, NOW)).toBe(NOW + 10 * M);
  });
  it("within 2.5 min of now = live", () => expect(snapTime(NOW + 2 * M, mags, 15 * M, 40 * M, NOW)).toBe(NOW));
});

describe("HRRR forecast minute", () => {
  it("15-min steps to 5 h, hourly after", () => {
    expect(forecastMinuteFor("2026-10-09T19:00:00Z", NOW, 30)).toBe(165);
    expect(forecastMinuteFor("2026-10-09T19:00:00Z", NOW, 180)).toBe(300);
    expect(forecastMinuteFor("2026-10-09T18:00:00Z", NOW, 180)).toBe(380 - 20);
  });
});
