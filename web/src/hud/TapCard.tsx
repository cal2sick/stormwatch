import { useEffect, useRef, useState } from "react";
import { bearingDeg, distanceMi } from "../geo";
import { fmtET } from "../time";
import RainSoFar from "./RainSoFar";

// v0.6.1 tap-on-map area card. Every tap fetches /api/point for THAT exact point (debounced, in-flight request
// cancelled on a new tap, cached per 0.01 deg + hour). Every number shows its source and time; missing data says so.
interface S<T> { value: T | null; source: string; time: string | null; note?: string }
export interface PointCardData {
  lat: number; lon: number; key: string; at: string; fetched: string; place: S<string>;
  wind: S<{ mph: number; dir: string | null }>; gust: S<number>; rainChance: S<number>; rainIn: S<number>;
  alerts: S<{ event: string; headline: string | null; severity: string | null; onset: string | null; ends: string | null; sender: string | null }[]>;
  outages: S<{ nearestMi: number | null; customersNearby: number; radiusMi: number; county: string | null; countyOut: number | null; coverage: string }>;
  radar: S<{ dbz: number | null; words: string; nearbyMaxDbz: number | null; nearbyWords: string; scan: string }>;
}
export interface TapPoint { lat: number; lon: number; seq: number; hazards: string[]; areas?: string[] }
const cache = new Map<string, { at: number; d: PointCardData }>();
/** Standard reflectivity colors (green, yellow, orange, red, magenta) for the radar chip. */
export const dbzColor = (dbz: number | null) => dbz == null || dbz < 10 ? "#6c7d8f" : dbz < 20 ? "#7fd3a8" : dbz < 30 ? "#2fbf4a" : dbz < 40 ? "#f5e33b" : dbz < 50 ? "#ff8c1a" : dbz < 58 ? "#ff3b30" : "#e14be8";
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
  const rd = d?.radar.value ?? null;
  const short = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET" : "";
  const alerts = d?.alerts.value ?? null;
  return (
    <div className="tap-card tc2" role="dialog" aria-label="Details for the tapped spot" data-testid="tap-card">
      <button className="x-close" aria-label="Close" title="Close (Esc)" onClick={onClose} data-testid="tap-close">✕</button>
      <div className="tc-place" data-testid="tap-place">{d ? (d.place.value ?? "Unnamed spot") : "Loading this spot…"}</div>
      <div className="tc-coords num">{point.lat.toFixed(4)}, {point.lon.toFixed(4)} · for {fmtET(new Date(time).toISOString())}</div>
      {err && <p className="tm-text">{err}</p>}
      <div className={`tc-radar ${rd ? "" : "none"}`} data-testid="tap-radar" style={{ ["--dbz" as string]: dbzColor(rd?.dbz ?? null) }}>
        <i className="tc-radar-dot" aria-hidden="true" />
        <div>
          <b>{!d ? "Checking radar…" : rd ? rd.words : "Radar: unavailable"}</b>
          <span>{!d ? "" : rd ? `${rd.dbz != null ? `${rd.dbz} dBZ` : "no echo"} here${rd.nearbyMaxDbz != null && rd.nearbyMaxDbz !== rd.dbz ? ` · within 3 mi: ${rd.nearbyWords.toLowerCase()} (${rd.nearbyMaxDbz} dBZ)` : ""} · scan ${short(rd.scan)}` : d.radar.note}</span>
        </div>
      </div>
      <div className="tc-big">
        <div><span title="Steady wind and the direction it blows from">Wind{d?.wind.value?.dir ? ` ${d.wind.value.dir}` : ""}</span><b data-testid="tap-wind">{val(d?.wind, (w) => `${w.mph}`)}<small>{d?.wind.value ? " mph" : ""}</small></b></div>
        <div className={(d?.gust.value ?? 0) >= 58 ? "hot" : (d?.gust.value ?? 0) >= 39 ? "warm" : ""}><span>Gusts</span><b data-testid="tap-gust">{val(d?.gust, (g) => `${g}`)}<small>{d?.gust.value != null ? " mph" : ""}</small></b></div>
        <div><span>Rain chance</span><b data-testid="tap-pop">{val(d?.rainChance, (p) => `${p}`)}<small>{d?.rainChance.value != null ? "%" : ""}</small></b></div>
        <div><span>{storm ? `To ${storm.name}` : "Storm"}</span><b data-testid="tap-dist">{dist != null ? `${dist}` : "—"}<small>{dist != null ? ` mi ${dir}` : ""}</small></b></div>
      </div>
      {d && (d.wind.value == null && d.wind.note) && <p className="tm-text tc-note">{d.wind.note}</p>}
      <RainSoFar lat={point.lat} lon={point.lon} compact />
      <div className="tc-alerts" data-testid="tap-alerts">
        {!d ? null : alerts == null ? <p className="tm-text">Alerts: unavailable ({d.alerts.note})</p>
          : alerts.length === 0 ? <p className="tc-ok">No NWS alerts in effect here at this time.</p>
          : <ul>{alerts.map((a, i) => <li key={i} className={`sev-${(a.severity ?? "").toLowerCase()}`}><b>{a.event}</b>{a.ends ? <span> until {fmtET(a.ends)}</span> : null}</li>)}</ul>}
      </div>
      {(point.areas?.length ?? 0) > 0 && <p className="tm-text" data-testid="tap-area">Outage area here: {point.areas!.join(" | ")}</p>}
      {point.hazards.length > 0 && <p className="tm-text">On the map here: {point.hazards.join(" · ")}</p>}
      <button className="btn tc-more-btn" onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? "Fewer details" : "More details"}</button>
      {more && d && <div className="tc-more">
        <p>Rain amount: {val(d.rainIn, (v) => `${v} in`)} {src(d.rainIn)}</p>
        <p>Power: {d.outages.value == null ? `unavailable (${d.outages.note})` : d.outages.value.coverage === "point-feed"
          ? `${d.outages.value.customersNearby.toLocaleString()} customers out within ${d.outages.value.radiusMi} mi${d.outages.value.nearestMi != null ? `, nearest ${d.outages.value.nearestMi} mi away` : ""}`
          : d.outages.value.county ? `${d.outages.value.county}: ${d.outages.value.countyOut?.toLocaleString() ?? "?"} out (county total)` : "no free outage feed covers this spot"} {src(d.outages)}</p>
        <p>Storm distance: {storm ? `from the NHC position ${storm.live ? "now" : "at the selected time"} (estimate)` : "no storm"}</p>
        {d.alerts.value?.map((a, i) => a.headline ? <p key={i} className="verbatim">{a.headline}</p> : null)}
      </div>}
      {d && <div className="tc-sources">
        <div>Wind, gusts, rain: {d.wind.source}{d.wind.time ? ` · updated ${fmtET(d.wind.time)}` : ""}</div>
        <div>Radar: {d.radar.source}{d.radar.time ? ` · scan ${fmtET(d.radar.time)}` : ""}</div>
        <div>Alerts: {d.alerts.source}{d.alerts.time ? ` · ${fmtET(d.alerts.time)}` : ""}</div>
        <div>Place: {d.place.source}</div>
      </div>}
    </div>
  );
}
