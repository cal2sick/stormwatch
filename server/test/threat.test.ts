import { describe, expect, it } from "vitest";
import { applyHysteresis, computeThreat } from "../src/threat.js";
import type { Thresholds } from "../src/config.js";
import type { NwsAlert, Storm } from "../src/types.js";

const t = {
  distanceMi: { yellow: 300, orange: 150, red: 75 }, tsWindArrivalHoursOrange: 12, inConeYellowMaxMi: 300,
  alertEvents: { yellow: ["Flood Watch"], orange: ["Tropical Storm Warning"], red: ["Hurricane Warning"] },
  yellowOnAnyWatchOrAdvisory: true, redOnSeverityExtreme: true, allFeedsStaleMinutes: 30, stepDownHysteresisMinutes: 30,
  notify: { pressureDropMb: 10, gaugeRiseFt3h: 1 }, pollSeconds: {},
} as unknown as Thresholds;
const alert = (event: string, severity = "Severe") => ({ id: event, event, severity } as NwsAlert);
const storm = (p: Partial<Storm>) => ({ name: "X", distanceMi: 500, bearingCardinal: "S", inCone: false, tsArrival: null, ...p } as Storm);
const NOW = Date.parse("2026-10-09T17:00:00Z");

describe("computeThreat", () => {
  it("GREEN with nothing", () => expect(computeThreat([], [], t, false, NOW).level).toBe("GREEN"));
  it("alerts map to levels", () => {
    expect(computeThreat([alert("Flood Watch")], [], t, false, NOW).level).toBe("YELLOW");
    expect(computeThreat([alert("Tropical Storm Warning")], [], t, false, NOW).level).toBe("ORANGE");
    expect(computeThreat([alert("Hurricane Warning")], [], t, false, NOW).level).toBe("RED");
    expect(computeThreat([alert("Special Weather Statement", "Extreme")], [], t, false, NOW).level).toBe("RED");
  });
  it("in cone within 300 mi -> YELLOW; outside cone -> GREEN", () => {
    expect(computeThreat([], [storm({ distanceMi: 250, inCone: true })], t, false, NOW).level).toBe("YELLOW");
    expect(computeThreat([], [storm({ distanceMi: 250, inCone: false })], t, false, NOW).level).toBe("GREEN");
  });
  it("distance rules", () => {
    expect(computeThreat([], [storm({ distanceMi: 120 })], t, false, NOW).level).toBe("ORANGE");
    expect(computeThreat([], [storm({ distanceMi: 60 })], t, false, NOW).level).toBe("RED");
  });
  it("TS-wind arrival within 12 h -> ORANGE; 20 h -> not", () => {
    const at = (h: number) => storm({ tsArrival: { earliest: new Date(NOW + h * 3_600_000).toISOString(), mostLikely: null, earliestBound: "at", mostLikelyBound: null, advisoryNumber: "1" } });
    expect(computeThreat([], [at(6)], t, false, NOW).level).toBe("ORANGE");
    expect(computeThreat([], [at(20)], t, false, NOW).level).toBe("GREEN");
  });
  it("thresholds are data: raising orange distance changes the level", () => {
    const t2 = { ...t, distanceMi: { ...t.distanceMi, orange: 260 } } as Thresholds;
    expect(computeThreat([], [storm({ distanceMi: 250 })], t2, false, NOW).level).toBe("ORANGE");
  });
  it("DATA STALE when all feeds stale", () => expect(computeThreat([], [], t, true, NOW).level).toBe("DATA STALE"));
});

describe("applyHysteresis", () => {
  it("steps up immediately, steps down only after the delay", () => {
    let r = applyHysteresis(null, "ORANGE", 30, NOW);
    expect(r.state.level).toBe("ORANGE");
    r = applyHysteresis(r.state, "YELLOW", 30, NOW + 60_000);
    expect(r.state.level).toBe("ORANGE"); expect(r.holdUntil).not.toBeNull();
    r = applyHysteresis(r.state, "YELLOW", 30, NOW + 32 * 60_000);
    expect(r.state.level).toBe("YELLOW");
  });
});
