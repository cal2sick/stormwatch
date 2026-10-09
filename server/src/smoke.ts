// One-shot check: fetch every feed once (sequentially) and print what came back. `npm run smoke`
// Exits non-zero only if a CORE feed (NHC, NWS alerts) fails; other feeds are reported.
import { runAllOnce, getSnapshot } from "./poller.js";

const results = await runAllOnce();
const s = getSnapshot();
const et = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—";
console.log("feeds:");
for (const [k, f] of Object.entries(s.feeds)) console.log(`  ${results[k] ? "OK  " : "FAIL"} ${k.padEnd(9)} ${f.error ?? `source time ${et(f.sourceTime)}`}`);
for (const x of s.storms) {
  console.log(`storm: ${x.name} ${x.classification} ${x.category} ${x.intensityKt}kt ${x.pressureMb}mb adv ${x.advisoryNumber} | ${x.distanceMi} mi ${x.bearingCardinal} | inCone=${x.inCone}`);
  console.log(`  TS winds earliest ${x.tsArrival?.earliestBound ?? ""} ${et(x.tsArrival?.earliest)} · most likely ${x.tsArrival?.mostLikelyBound ?? ""} ${et(x.tsArrival?.mostLikely)}`);
  console.log(`  closest approach (track) ${x.trackCpa?.distanceMi} mi at ${et(x.trackCpa?.time)} · (motion) ${x.motionCpa?.distanceMi} mi at ${et(x.motionCpa?.time)}`);
  console.log(`  advisory text: ${x.advisoryText ? x.advisoryText.length + " chars" : "none"}`);
}
console.log("alerts:", s.alerts.map((a) => `${a.event} (${a.severity})`));
console.log("forecast:", s.forecast ? `${s.forecast.office} ${s.forecast.hourly.length}h, max gust ${s.forecast.maxGust48Mph} mph, QPF 24h ${s.forecast.qpf24In} in / 48h ${s.forecast.qpf48In} in` : "none");
console.log("radar frames:", s.radar?.frames.length ?? 0);
console.log("gauges:", s.gauges.map((g) => `${g.name}: ${g.stageFt} ft (${g.trend} ${g.change3hFt ?? "?"})`).slice(0, 5), `(+${Math.max(0, s.gauges.length - 5)} more)`);
console.log("buoys:", s.buoys.map((b) => `${b.id} ${b.distanceToStormMi}mi from storm: ${b.windKt}kt G${b.gustKt} ${b.pressureMb}mb ${b.waveFt}ft`));
console.log("power (plugin):", s.power.local ? `${s.power.local.count} outages, ${s.power.local.totalCustomers} customers, nearest ${s.power.local.nearestMi} mi` : "none", "| ODIN rows:", s.power.odin?.rows.length ?? "—");
console.log("threat:", s.threat.level, s.threat.reasons);
process.exit(results.nhc && results.nws ? 0 : 1);
