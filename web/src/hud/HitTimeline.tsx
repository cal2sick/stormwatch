import { useMemo } from "react";
import type { HourlyPoint, NwsAlert } from "../types";
import { hitTimeline, windColor } from "../hitTimeline";
import RainSoFar from "./RainSoFar";

const hr = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric" }).replace(" ", "").toLowerCase();
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
const when = (t: number) => `${day(t)} ${hr(t)}`;

/** v0.7 hour-by-hour strip for home: gust bars colored by impact, rain chance, alert color ticks; worst hours glow. Tap an hour to move the map there. */
export default function HitTimeline({ hourly, alerts, now, place, onPick, selected, point }: {
  point?: { lat: number; lon: number } | null;
  hourly: HourlyPoint[]; alerts: NwsAlert[]; now: number; place: string; onPick: (t: number) => void; selected: number | null;
}) {
  const { rows, summary } = useMemo(() => hitTimeline(hourly, alerts, now), [hourly, alerts, Math.floor(now / 600_000)]);
  if (!rows.length) return <p className="tm-text">No National Weather Service hourly forecast for {place} right now.</p>;
  const top = Math.max(60, ...rows.map((r) => r.score));
  const p = summary.peak;
  return (
    <div className="hit" data-testid="hit-timeline">
      <p className="hit-sum">
        {p && summary.worstStart != null ? <>Worst: <b>{when(summary.worstStart)}–{hr(summary.worstEnd!)}</b>, {p.gustIsWind ? "winds" : "gusts"} up to <b className="num" style={{ color: windColor(p.score) }}>{p.score} mph</b>.</>
          : <>No strong wind in the next {rows.length} hours.</>}
        {summary.firstTsGust != null && summary.firstTsGust !== summary.worstStart ? <> Tropical-storm-force gusts (39+ mph) from <b>{when(summary.firstTsGust)}</b>.</> : null}
      </p>
      <div className="hit-strip" role="list">
        {rows.map((r, i) => {
          const newDay = i === 0 || day(r.t) !== day(rows[i - 1].t);
          const sel = selected != null && selected >= r.t && selected < r.t + 3.6e6;
          return <button key={r.t} role="listitem" className={`hit-col ${r.worst ? "worst" : ""} ${sel ? "sel" : ""}`} onClick={() => onPick(r.t)}
            title={`${when(r.t)}: wind ${r.wind ?? "?"} mph, ${r.gustIsWind ? "no gust forecast" : `gusts ${r.gust ?? "?"} mph`}, rain chance ${r.pop ?? "?"}%. ${r.text}${r.alerts.length ? `\nIn effect: ${r.alerts.map((a) => a.event).join(", ")}` : ""}`}>
            <span className="hit-day">{newDay ? day(r.t) : " "}</span>
            <span className="hit-g num">{r.gust ?? "–"}</span>
            <span className="hit-bar"><i style={{ height: `${Math.max(4, ((r.gust ?? 0) / top) * 100)}%`, background: windColor(r.gust) }} /></span>
            <span className="hit-pop num" style={{ opacity: r.pop == null ? 0.4 : 0.35 + (r.pop / 100) * 0.65 }}>{r.pop ?? "–"}%</span>
            <span className="hit-al">{r.alerts.slice(0, 3).map((a) => <i key={a.event} style={{ background: a.color }} />)}</span>
            <span className="hit-h">{hr(r.t)}</span>
          </button>;
        })}
      </div>
      {point && <RainSoFar lat={point.lat} lon={point.lon} />}
      <div className="hit-key"><span>Bars: gusts (mph)</span><span>%: rain chance</span><span>Dots: alerts in effect</span></div>
    </div>
  );
}
