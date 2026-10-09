import { describe, expect, it } from "vitest";
import { goesTimeAt, iemStampAt, radarForTime } from "../../web/src/map/sliderView";
import { iemStamp, pickIemFrames } from "../src/sources/radar";

const T0 = Date.parse("2026-10-09T18:00:00Z"), H = 3.6e6;
const frames = Array.from({ length: 13 }, (_, i) => ({ time: new Date(T0 - (12 - i) * 600_000).toISOString(), path: iemStamp(new Date(T0 - (12 - i) * 600_000).toISOString()) }));

describe("IEM radar", () => {
  it("picks ~10-minute frames from 5-minute scans, newest kept", () => {
    const scans = Array.from({ length: 30 }, (_, i) => ({ ts: new Date(T0 - (29 - i) * 300_000).toISOString().slice(0, 16) + "Z" }));
    const f = pickIemFrames(scans);
    expect(f).toHaveLength(13); expect(f.at(-1)!.path).toBe("202610091800"); expect(f[0].path).toBe("202610091600");
  });
  it("past beyond the loop uses the archived scan at that time", () => {
    const p = radarForTime(frames, T0 - 5 * H - 7 * 60_000, T0, false, true);
    expect(p.mode).toBe("archive");
    if (p.mode === "archive") expect(p.stamp).toBe("202610091250");
    expect(iemStampAt(Date.parse("2026-10-09T12:54:59Z")).stamp).toBe("202610091250");
  });
  it("no archive for future times or older than a week", () => {
    expect(radarForTime(frames, T0 + H, T0, false, true).mode).toBe("future");
    expect(radarForTime(frames, T0 - 8 * 24 * H, T0, false, true).mode).toBe("past-none");
  });
});

describe("GOES-19 time", () => {
  it("10-minute steps, clamped to ~30 min ago", () => {
    expect(goesTimeAt(Date.parse("2026-10-09T12:37:00Z"), T0)).toEqual({ time: "2026-10-09T12:30:00Z", clamped: false });
    expect(goesTimeAt(T0 + 6 * H, T0)).toEqual({ time: "2026-10-09T17:30:00Z", clamped: true });
  });
});

import { tideReadout } from "../src/sources/coops";
import { parseObs } from "../src/sources/localObs";
describe("CO-OPS water level readout", () => {
  it("observed minus predicted on MHHW, with 3-h change", () => {
    const obs = [{ t: "2026-10-09 15:00", v: "0.10" }, { t: "2026-10-09 16:00", v: "0.40" }, { t: "2026-10-09 18:00", v: "1.20" }];
    const pred = [{ t: "2026-10-09 17:54", v: "-0.30" }, { t: "2026-10-09 18:00", v: "-0.25" }];
    const r = tideReadout("8728690", { name: "Apalachicola", lat: "29.7244", lon: "-84.9806" }, obs, pred)!;
    expect(r).toMatchObject({ levelFtMhhw: 1.2, predictedFtMhhw: -0.25, aboveForecastFt: 1.45, change3hFt: 1.1, time: "2026-10-09T18:00:00.000Z" });
  });
  it("no data = null (keeps last known good upstream)", () => expect(tideReadout("1", undefined, [], [])).toBeNull());
});
describe("NWS station observation", () => {
  it("converts km/h, °C, Pa, mm", () => {
    const o = parseObs("KXYZ", "Test Airport", { timestamp: "2026-10-09T18:53:00+00:00", textDescription: "Rain", temperature: { value: 25 }, windSpeed: { value: 40 }, windGust: { value: 64.8 }, windDirection: { value: 90 }, seaLevelPressure: { value: 100500 }, precipitationLastHour: { value: 12.7 } });
    expect(o).toMatchObject({ tempF: 77, windMph: 25, gustMph: 40, pressureMb: 1005, rainLastHourIn: 0.5 });
  });
});
