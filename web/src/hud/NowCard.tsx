import { useMemo } from "react";
import type { Snapshot, Storm } from "../types";
import { bearingDeg, distanceMi } from "../geo";
import { compassWords, ktToMph } from "../format";
import { hitTimeline } from "../hitTimeline";
import { alertBarItems } from "./HazardBanner";
import { untilET } from "../hazards";
import { riskWord, RISK_MEANING } from "../plain";

const dayTime = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" });
const hr = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric" }).replace(":00", "");

/** v0.7.1 top of the left column: big readable time + "What this means for you" in 2 to 4 plain lines. */
export default function NowCard({ snap, threat, storm, now, sliderTime, live }: {
  snap: Snapshot | null; threat: Snapshot | null; storm: Storm | undefined; now: number; sliderTime: number | null; live: boolean;
}) {
  const level = threat?.threat.level ?? "DATA STALE";
  const home = snap?.home.configured ? snap.home : null;
  const hit = useMemo(() => snap?.forecast?.hourly ? hitTimeline(snap.forecast.hourly, snap.alerts ?? [], now).summary : null, [snap?.forecast?.hourly, snap?.alerts, Math.floor(now / 600_000)]);
  const items = snap ? alertBarItems(snap, now) : [];
  const t = sliderTime ?? now;
  const mode = live || sliderTime == null ? "live" : t < now ? "past" : "forecast";
  const lines: { k: string; v: JSX.Element | string }[] = [];
  if (storm && home) {
    const d = Math.round(distanceMi(home.lat, home.lon, storm.lat, storm.lon));
    const dir = compassWords(bearingDeg(home.lat, home.lon, storm.lat, storm.lon));
    lines.push({ k: "storm", v: <><b>{storm.name}</b> is about <b className="num">{d} miles</b> {dir} of {home.name.split(",")[0]}, with top winds near <b className="num">{ktToMph(storm.intensityKt) ?? "?"} mph</b>.</> });
  } else if (storm) lines.push({ k: "storm", v: <><b>{storm.name}</b>: top winds near {ktToMph(storm.intensityKt) ?? "?"} mph. Set your location below to see what it means for you.</> });
  else lines.push({ k: "storm", v: "No active hurricane or tropical storm right now." });
  if (items[0]) lines.push({ k: "alert", v: <><b style={{ color: items[0].color }}>{items[0].title}</b>{items[0].until ? ` until ${untilET(items[0].until)}` : ""}{items.length > 1 ? ` (+${items.length - 1} more alert${items.length > 2 ? "s" : ""})` : ""}.</> });
  if (hit?.peak && hit.worstStart != null && hit.peak.score >= 20) lines.push({ k: "wind", v: <>Windiest: <b>{hr(hit.worstStart)}–{hr(hit.worstEnd!)}</b>, {hit.peak.gustIsWind ? "winds" : "gusts"} up to <b className="num">{hit.peak.score} mph</b>.</> });
  const todo = items.find((i) => i.action)?.action ?? RISK_MEANING[level] ?? null;
  return (
    <section className="now-card" data-testid="now-card" aria-label="What this means for you">
      <div className="nc-time">
        <span className={`nc-mode m-${mode}`}>{mode === "live" ? "● Live now" : mode === "past" ? "Past (map is showing)" : "Forecast (map is showing)"}</span>
        <b className="num" data-testid="now-time">{dayTime(t)} <small>ET</small></b>
      </div>
      <div className="nc-head">
        <h2>What this means for you</h2>
        {home && <span className={`risk-pill lvl-${level.replace(" ", "-").toLowerCase()}`} data-testid="risk-pill"
          title={`Your risk: ${riskWord(level)}. Why:\n${(threat?.threat.reasons ?? []).join("\n")}`}>Your risk: <b>{riskWord(level)}</b></span>}
      </div>
      <ul className="nc-lines">{lines.map((l) => <li key={l.k}>{l.v}</li>)}</ul>
      {home && todo && <p className="nc-todo"><b>What to do:</b> {todo}</p>}
      {home && (threat?.threat.reasons?.length ?? 0) > 0 && <details className="nc-why"><summary>Why is my risk {riskWord(level).toLowerCase()}?</summary>
        <ul>{threat!.threat.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>}
    </section>
  );
}
