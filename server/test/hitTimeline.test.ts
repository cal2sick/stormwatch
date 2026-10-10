import { describe, expect, it } from "vitest";
import { hitTimeline, alertColor, windColor } from "../../web/src/hitTimeline";

const now = Date.parse("2026-10-09T23:20:00Z");
const h = (i: number, wind: number | null, gust: number | null, pop = 50) => ({ time: new Date(Date.parse("2026-10-09T23:00:00Z") + i * 3.6e6).toISOString(), tempF: 80, windMph: wind, gustMph: gust, windDir: "SE", pop, shortForecast: "Rain" }) as any;
const alert = (event: string, onset: string, ends: string) => ({ id: event, event, severity: "Severe", urgency: "", certainty: "", headline: null, description: "", instruction: null, onset, ends, sent: onset }) as any;

describe("when does it hit me", () => {
  const hourly = [h(-1, 50, 70), h(0, 10, 15), h(1, 20, 30), h(2, 30, 45), h(3, 35, 52), h(4, 34, 50), h(5, 20, null), h(40, 5, 5)];
  const alerts = [alert("Tropical Storm Warning", "2026-10-09T20:00:00Z", "2026-10-10T03:00:00Z"), alert("Hurricane Local Statement", "2026-10-09T20:00:00Z", "2026-10-10T08:00:00Z")];
  const { rows, summary } = hitTimeline(hourly, alerts, now, 36);
  it("keeps only the next 36 hours, from the current hour", () => { expect(rows.length).toBe(6); expect(rows[0].gust).toBe(15); });
  it("peak and worst span are the strongest gusts and the hours within 5 mph", () => {
    expect(summary.peak?.score).toBe(52);
    expect(rows.filter((r) => r.worst).map((r) => r.gust)).toEqual([52, 50]);
    expect(summary.worstStart).toBe(Date.parse("2026-10-10T02:00:00Z"));
  });
  it("first tropical-storm-force gust", () => expect(summary.firstTsGust).toBe(Date.parse("2026-10-10T01:00:00Z")));
  it("no gust from NWS: uses steady wind and says so", () => { const r = rows.at(-1)!; expect(r.gust).toBe(20); expect(r.gustIsWind).toBe(true); });
  it("alerts by hour, statements left out, NWS colors", () => {
    expect(rows[0].alerts.map((a) => a.event)).toEqual(["Tropical Storm Warning"]);
    expect(rows.find((r) => r.t >= Date.parse("2026-10-10T03:00:00Z"))!.alerts).toEqual([]);
    expect(alertColor("Tornado Warning")).toBe("#ff2a2a"); // v0.7.1: same palette as the map
  });
  it("wind colors by impact band", () => { expect(windColor(40)).toBe("#ff922b"); expect(windColor(80)).toBe("#e14be8"); });
});
