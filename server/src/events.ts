import { createHash } from "node:crypto";
import type { HudEvent, Snapshot } from "./types.js";

export function mkEvent(kind: string, text: string, level: HudEvent["level"], time = new Date().toISOString()): HudEvent {
  return { id: createHash("sha1").update(kind + text + time).digest("hex").slice(0, 12), time, kind, text, level };
}

/** Compare the previous and next snapshot and emit notable events (SPEC §5 "other notifications"). */
export function diffEvents(prev: Snapshot | null, next: Snapshot, opts: { pressureDropMb: number; gaugeRiseFt3h: number; nearOutageMi: number; staleFeedMinutes: number }, memo: Map<string, number>): HudEvent[] {
  if (!prev) return [];
  const out: HudEvent[] = [];
  const now = Date.now();
  const once = (key: string, ttlMs: number) => { const t = memo.get(key); if (t && now - t < ttlMs) return false; memo.set(key, now); return true; };
  for (const s of next.storms) {
    const p = prev.storms.find((x) => x.id === s.id);
    if (!p) { out.push(mkEvent("storm", `New active storm: ${s.name} (${s.classification})`, "warn")); continue; }
    if (s.advisoryNumber && p.advisoryNumber && s.advisoryNumber !== p.advisoryNumber)
      out.push(mkEvent("advisory", `NHC advisory ${s.advisoryNumber} for ${s.name}: ${s.intensityKt ?? "?"} kt, ${s.pressureMb ?? "?"} mb`, "info"));
    if (s.category !== p.category) out.push(mkEvent("category", `${s.name} changed ${p.category} → ${s.category}`, "warn"));
    if (s.pressureMb != null && p.pressureMb != null && p.pressureMb - s.pressureMb >= opts.pressureDropMb)
      out.push(mkEvent("pressure", `${s.name} pressure dropped ${p.pressureMb - s.pressureMb} mb (${p.pressureMb} → ${s.pressureMb})`, "warn"));
    if (s.inCone && !p.inCone) out.push(mkEvent("cone", `Your point is now inside the cone for ${s.name}`, "warn"));
  }
  const prevIds = new Set(prev.alerts.map((a) => a.id));
  for (const a of next.alerts) if (!prevIds.has(a.id)) out.push(mkEvent("alert", `New NWS alert: ${a.event}`, /Warning|Emergency/.test(a.event) ? "alert" : "warn"));
  for (const g of next.gauges) {
    if (g.change3hFt != null && g.change3hFt >= opts.gaugeRiseFt3h && once(`gauge:${g.id}`, 3 * 3_600_000))
      out.push(mkEvent("gauge", `${g.name} rising ${g.change3hFt.toFixed(2)} ft in 3 h (stage ${g.stageFt} ft)`, "warn"));
  }
  const prevOut = new Set((prev.power.local?.outages ?? []).map((o) => `${o.lat},${o.lon}`));
  for (const o of next.power.local?.outages ?? []) {
    if (!prevOut.has(`${o.lat},${o.lon}`) && o.distanceMi <= opts.nearOutageMi)
      out.push(mkEvent("power", `New power outage ${o.distanceMi} mi from you (${o.customers} customers)`, "warn"));
  }
  for (const [k, f] of Object.entries(next.feeds)) {
    const age = f.lastSuccess ? (now - Date.parse(f.lastSuccess)) / 60_000 : Infinity;
    if (age > opts.staleFeedMinutes) { if (once(`stale:${k}`, 6 * 3_600_000)) out.push(mkEvent("stale", `Feed stale > ${opts.staleFeedMinutes} min: ${f.source}`, "warn")); }
    else memo.delete(`stale:${k}`);
  }
  if (next.threat.level !== prev.threat.level)
    out.push(mkEvent("threat", `Threat level ${prev.threat.level} → ${next.threat.level}: ${next.threat.reasons[0] ?? ""}`, next.threat.level === "RED" ? "alert" : "warn"));
  return out;
}
