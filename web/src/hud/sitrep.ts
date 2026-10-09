import type { Snapshot, Storm } from "../types";
import { className, compassWords, ktToMph } from "../format";
import { fmtDayET } from "../time";

/** Zulu date-time group, e.g. 091700Z OCT 26 */
export function dtg(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** Briefing-style SITREP built ONLY from feed fields (no hard-coded storm values, no LLM). */
export function sitrepParas(snap: Snapshot, s: Storm | undefined): { tag: string; text: string }[] {
  const out: { tag: string; text: string }[] = [];
  if (!s) out.push({ tag: "Situation", text: "No active tropical cyclones in the NHC feed." });
  else {
    const cat = /CAT (\d)/.exec(s.category)?.[1];
    const kind = s.classification === "HU" && cat ? `Category ${cat} hurricane` : className(s.classification).toLowerCase();
    const motion = s.movementDirDeg != null && s.movementSpeedMph != null ? ` Moving ${compassWords(s.movementDirDeg)} at ${s.movementSpeedMph} mph.` : "";
    out.push({ tag: "Situation", text: `NHC advisory ${Number(s.advisoryNumber ?? 0) || s.advisoryNumber || "?"} (${fmtDayET(s.advisoryIssuance)}). ${s.name.toUpperCase()}, ${kind}. Max sustained ${ktToMph(s.intensityKt) ?? "?"} mph (${s.intensityKt ?? "?"} kt), min pressure ${s.pressureMb ?? "?"} mb.${motion}` });
    if (snap.home.configured) {
    const prox = [`Center ${Math.round(s.distanceMi)} mi ${compassWords(s.bearingDeg)} of home as of ${fmtDayET(s.lastUpdate)}.`];
    if (s.inCone != null) prox.push(s.inCone ? "Home is INSIDE the forecast cone." : "Home is outside the forecast cone; hazards extend beyond it.");
    if (s.trackCpa) prox.push(s.trackCpa.receding ? "Forecast track moves away from home." : `Closest approach on NHC track ~${Math.round(s.trackCpa.distanceMi)} mi near ${fmtDayET(s.trackCpa.time)}.`);
    out.push({ tag: "Distance", text: prox.join(" ") + " (Estimates.)" });
    const a = s.tsArrival;
    if (a && (a.mostLikely || a.earliest)) {
      const w = (b: string | null) => (b === "before" ? "by " : b === "after" ? "after " : "");
      out.push({ tag: "When strong winds arrive", text: `Tropical-storm-force winds: earliest reasonable ${w(a.earliestBound)}${fmtDayET(a.earliest)}; most likely ${w(a.mostLikelyBound)}${fmtDayET(a.mostLikely)}. (NHC arrival product, estimate.)` });
    } else if (a) out.push({ tag: "When strong winds arrive", text: "NHC arrival product does not reach home this advisory." });
    } else out.push({ tag: "Distance", text: "No location set. Add HOME_LAT and HOME_LON to .env for distance, alerts and winds at your place." });
  }
  if (!snap.home.configured) { out.push({ tag: "Overall", text: snap.threat.reasons[0] ?? "" }); return out; }
  const al = snap.alerts;
  out.push({ tag: "Local alerts", text: al.length ? `${al.length} NWS product${al.length > 1 ? "s" : ""} in effect for home: ${[...new Set(al.map((x) => x.event))].join("; ")}. Full text verbatim in ALERTS.` : "No NWS alerts in effect for home." });
  const f = snap.forecast;
  if (f) out.push({ tag: "Forecast", text: `NWS ${f.office ?? ""}: gusts to ${f.maxGust48Mph ?? "?"} mph within 48 h; rain ~${f.qpf24In ?? "?"} in / 24 h, ~${f.qpf48In ?? "?"} in / 48 h.` });
  const p = snap.power.local;
  const risers = snap.gauges.filter((g) => g.trend === "rising").length;
  out.push({ tag: "Power", text: `${p ? (p.count ? `${p.name}: ${p.count} outage(s), ${p.totalCustomers} customer(s); nearest ${p.nearestMi} mi.` : `${p.name}: no outages reported.`) : "No live power feed configured (check your utility's outage map)."} ${risers} of ${snap.gauges.length} river gauges rising.` });
  out.push({ tag: "Overall", text: `Threat level: ${snap.threat.level.toLowerCase()}. ${snap.threat.reasons[0] ?? ""}` });
  return out;
}

/** The "..." headline paragraphs at the top of the NHC public advisory, verbatim. */
export function advisoryHeadline(text: string | null): string | null {
  if (!text) return null;
  const m = /\n\s*\n(\.\.\.[\s\S]*?\.\.\.)\s*\n\s*\n/.exec(text);
  return m ? m[1].trim() : null;
}
