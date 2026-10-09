import type { Thresholds } from "./config.js";
import type { NwsAlert, Storm, ThreatLevel } from "./types.js";

export const RANK: Record<ThreatLevel, number> = { "SET LOCATION": -2, "DATA STALE": -1, GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

const fmtET = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";

/** Threat engine per SPEC §5 (pure). Highest level triggered by any rule wins. */
export function computeThreat(alerts: NwsAlert[], storms: Storm[], t: Thresholds, allStale: boolean, now = Date.now()) {
  if (allStale) return { level: "DATA STALE" as ThreatLevel, reasons: ["All feeds stale. Check official sources."] };
  let level: ThreatLevel = "GREEN";
  const reasons: string[] = [];
  const bump = (l: ThreatLevel, why: string) => {
    if (RANK[l] > RANK[level]) { level = l; reasons.unshift(why); } else reasons.push(why);
  };
  const seen = new Set<string>();
  for (const a of alerts) {
    if (seen.has(a.event)) continue;
    seen.add(a.event);
    if (t.alertEvents.red.includes(a.event)) bump("RED", `${a.event} in effect for your point`);
    else if (t.redOnSeverityExtreme && a.severity === "Extreme") bump("RED", `${a.event} (severity Extreme)`);
    else if (t.alertEvents.orange.includes(a.event)) bump("ORANGE", `${a.event} in effect for your point`);
    else if (t.alertEvents.yellow.includes(a.event)) bump("YELLOW", `${a.event} in effect for your point`);
    else if (t.yellowOnAnyWatchOrAdvisory && /Watch|Advisory/.test(a.event)) bump("YELLOW", `${a.event} in effect`);
  }
  const s = storms[0];
  if (s) {
    const d = s.distanceMi, th = t.distanceMi;
    const where = `${s.name} ${Math.round(d)} mi ${s.bearingCardinal} of you (estimate)`;
    if (d <= th.red) bump("RED", where);
    else if (d <= th.orange) bump("ORANGE", where);
    const coneMax = (t.inConeYellowMaxMi as number | undefined) ?? th.yellow;
    if (s.inCone && d <= coneMax) bump("YELLOW", `Your point is inside the NHC cone; ${where}`);
    const eta = s.tsArrival?.earliest;
    const hrs = (t.tsWindArrivalHoursOrange as number | undefined) ?? 12;
    if (eta) {
      const h = (Date.parse(eta) - now) / 3_600_000;
      const pre = s.tsArrival?.earliestBound === "after" ? "after " : s.tsArrival?.earliestBound === "before" ? "by " : "";
      if (h <= 0) bump("ORANGE", `Tropical-storm-force winds possible now (NHC earliest reasonable arrival ${pre}${fmtET(eta)}, estimate)`);
      else if (h <= hrs) bump("ORANGE", `Tropical-storm-force winds could arrive in ~${Math.round(h)} h (NHC earliest reasonable ${pre}${fmtET(eta)}, estimate)`);
    }
  }
  if (reasons.length === 0) reasons.push("No active NWS alerts for your point");
  return { level, reasons };
}

export interface HystState { level: ThreatLevel; belowSince: number | null }

/** A level only steps down after it has been below its trigger for `minutes` (SPEC §5). */
export function applyHysteresis(prev: HystState | null, computed: ThreatLevel, minutes: number, now = Date.now()) {
  if (!prev || computed === "DATA STALE" || prev.level === "DATA STALE" || computed === "SET LOCATION" || prev.level === "SET LOCATION" || RANK[computed] >= RANK[prev.level]) {
    return { state: { level: computed, belowSince: null }, holdUntil: null as string | null };
  }
  const since = prev.belowSince ?? now;
  if (now - since >= minutes * 60_000) return { state: { level: computed, belowSince: null }, holdUntil: null };
  return { state: { level: prev.level, belowSince: since }, holdUntil: new Date(since + minutes * 60_000).toISOString() };
}
