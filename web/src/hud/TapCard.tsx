import { useEffect, useRef, useState } from "react";
import { bearingDeg, distanceMi } from "../geo";
import { fmtET } from "../time";

// v0.6.1 tap-on-map area card. Every tap fetches /api/point for THAT exact point (debounced, in-flight request
// cancelled on a new tap, cached per 0.01 deg + hour). Every number shows its source and time; missing data says so.
interface S<T> { value: T | null; source: string; time: string | null; note?: string }
export interface PointCardData {
  lat: number; lon: number; key: string; at: string; fetched: string; place: S<string>;
  wind: S<{ mph: number; dir: string | null }>; gust: S<number>; rainChance: S<number>; rainIn: S<number>;
  alerts: S<{ event: string; headline: string | null; severity: string | null; onset: string | null; ends: string | null; sender: string | null }[]>;
  outages: S<{ nearestMi: number | null; customersNearby: number; radiusMi: number; county: string | null; countyOut: number | null; coverage: string }>;
  radar: S<string>;
}
export interface TapPoint { lat: number; lon: number; seq: number; hazards: string[]; areas?: string[] }
const cache = new Map<string, { at: number; d: PointCardData }>();
const C16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export default function TapCard({ point, time, storm, onClose }: {
  point: TapPoint; time: number; storm: { name: string; lat: number; lon: number; live: boolean } | null; onClose: () => void;
}) {
  const [d, setD] = useState<PointCardData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const hour = Math.floor(time / 3.6e6);
  useEffect(() => {
    const key = `${point.lat.toFixed(2)},${point.lon.toFixed(2)}@${hour}`;
    const hit = cache.get(key);
    setErr(null);
    if (hit && Date.now() - hit.at < 3 * 60_000) { setD(hit.d); return; }
    setD(null);
    const t = setTimeout(async () => {
      ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
      try {
        const r = await fetch(`/api/point?lat=${point.lat}&lon=${point.lon}&t=${Math.round(time)}`, { signal: c.signal });
        const j = await r.json();
        if (c.signal.aborted) return;
        if (!r.ok) { setErr(j.error ?? "Data for this point is not available right now."); return; }
        cache.set(key, { at: Date.now(), d: j }); setD(j);
      } catch (e: any) { if (e?.name !== "AbortError") setErr("Data for this point is not reachable right now."); }
    }, 250);
    return () => { clearTimeout(t); };
  }, [point.lat, point.lon, point.seq, hour]);
  useEffect(() => () => ctl.current?.abort(), []);
  const dist = storm ? Math.round(distanceMi(point.lat, point.lon, storm.lat, storm.lon)) : null;
  const dir = storm ? C16[Math.round(bearingDeg(point.lat, point.lon, storm.lat, storm.lon) / 22.5) % 16] : null;
  const src = (s: S<unknown> | undefined) => s ? <small className="tc-src">{s.source}{s.time ? ` · ${fmtET(s.time)}` : ""}</small> : null;
  const val = <T,>(s: S<T> | undefined, f: (v: T) => string) => !d ? "…" : s?.value == null ? "unavailable" : f(s.value);
  return (
    <div className="tap-card" role="dialog" aria-label="Details for the tapped spot" data-testid="tap-card">
      <button className="x-close" aria-label="Close" title="Close (Esc)" onClick={onClose} data-testid="tap-close">✕</button>
      <div className="tc-place" data-testid="tap-place">{d ? (d.place.value ?? "Unnamed spot") : "Loading this spot…"}</div>
      <div className="tc-coords">{point.lat.toFixed(4)}, {point.lon.toFixed(4)} · for {fmtET(new Date(time).toISOString())}</div>
      {err && <p className="tm-text">{err}</p>}
      <div className="tc-big">
        <div><b data-testid="tap-wind">{val(d?.wind, (w) => `${w.mph} mph`)}</b><span>wind{d?.wind.value?.dir ? ` from ${d.wind.value.dir}` : ""}</span></div>
        <div><b data-testid="tap-gust">{val(d?.gust, (g) => `${g} mph`)}</b><span>gusts</span></div>
        <div><b data-testid="tap-pop">{val(d?.rainChance, (p) => `${p}%`)}</b><span>rain chance</span></div>
        <div><b data-testid="tap-dist">{dist != null ? `${dist} mi` : "unavailable"}</b><span>{storm ? `to ${storm.name} (${dir})` : "no active storm"}</span></div>
      </div>
      {d && (d.wind.value == null && d.wind.note) && <p className="tm-text">{d.wind.note}</p>}
      <div className="tc-alerts" data-testid="tap-alerts">
        {!d ? null : d.alerts.value == null ? <p className="tm-text">Alerts: unavailable ({d.alerts.note})</p>
          : d.alerts.value.length === 0 ? <p className="tm-text">No NWS alerts in effect here at this time.</p>
          : <ul>{d.alerts.value.map((a, i) => <li key={i}><b>{a.event}</b>{a.ends ? ` · until ${fmtET(a.ends)}` : ""}</li>)}</ul>}
        {d && src(d.alerts)}
      </div>
      {(point.areas?.length ?? 0) > 0 && <p className="tm-text" data-testid="tap-area">Outage area here: {point.areas!.join(" | ")}</p>}
      {point.hazards.length > 0 && <p className="tm-text">On the map here: {point.hazards.join(" · ")}</p>}
      <button className="btn" onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? "Less" : "More details"}</button>
      {more && d && <div className="tc-more">
        <p>Rain amount: {val(d.rainIn, (v) => `${v} in`)} {src(d.rainIn)}</p>
        <p>Wind / gusts / rain chance: {src(d.wind.value != null ? d.wind : d.rainChance)}</p>
        <p>Power: {d.outages.value == null ? `unavailable (${d.outages.note})` : d.outages.value.coverage === "point-feed"
          ? `${d.outages.value.customersNearby.toLocaleString()} customers out within ${d.outages.value.radiusMi} mi${d.outages.value.nearestMi != null ? `, nearest ${d.outages.value.nearestMi} mi away` : ""}`
          : d.outages.value.county ? `${d.outages.value.county}: ${d.outages.value.countyOut?.toLocaleString() ?? "?"} out (county total)` : "no free outage feed covers this spot"} {src(d.outages)}</p>
        <p>Radar here: {d.radar.note}</p>
        <p>Storm distance: {storm ? `NHC position ${storm.live ? "now" : "at the selected time"}` : "no storm"}</p>
        {d.alerts.value?.map((a, i) => a.headline ? <p key={i} className="verbatim">{a.headline}</p> : null)}
      </div>}
    </div>
  );
}
