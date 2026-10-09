import { useEffect, useMemo, useState } from "react";
import type { AdvisoryRecord, Snapshot, Storm, StormGis, StormTimeline } from "../types";
import { cleanTrack, closestApproach, describe, fmtLat, fmtLon, fmtTime, ktToMph, roundMph5, stateAt, type TrackPoint, type TrackState } from "../track";
import { CONE_TEXT } from "../hazards";
import { adviceWindows, alertsActiveAt, fullTrack, hourAt, magnets, pathBetween, snapTime } from "../timeline";
import { advisoryLabel, coneCircleAt, radiiAt, sliderRange, timelineTrack, type RadiiState } from "../stormTime";

export type SliderState = TrackState & { trail: [number, number][]; uncertaintyMi: number; live: boolean; radii: RadiiState; coneTau: number | null };
const fmtShort = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric" });

const STEP = 15 * 60_000;

/** End of tomorrow, 11:59 PM America/New_York. */
export function endOfTomorrowET(now: number): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const [y, m, d] = ymd.split("-").map(Number);
  // Try both EDT/EST offsets; pick the one that formats back to 23:59 ET.
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m - 1, d + 1, 23 + off, 59);
    const hm = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
    if (hm === "23:59") return t;
  }
  return now + 48 * 3.6e6;
}

/** Build the track: NHC past track (best track) + latest observed position + NHC forecast points. */
export function buildTrack(storm: Storm | undefined, gis: StormGis | undefined): TrackPoint[] {
  const fc: TrackPoint[] = [];
  for (const f of gis?.forecastPoints?.features ?? []) {
    const p = f.properties as Record<string, unknown> | null; const g = f.geometry as GeoJSON.Point | null;
    if (!p || !g || g.type !== "Point" || typeof p.time !== "string") continue;
    fc.push({ time: Date.parse(p.time), lon: g.coordinates[0], lat: g.coordinates[1], windKt: typeof p.maxWindKt === "number" ? p.maxWindKt : null,
      mslp: typeof p.mslp === "number" ? p.mslp : null, tau: typeof p.tau === "number" ? p.tau : null, type: (p.type as string) ?? null, source: "NHC forecast" });
  }
  const past: TrackPoint[] = [];
  for (const f of gis?.bestTrack?.features ?? []) {
    const p = f.properties as Record<string, unknown> | null; const g = f.geometry as GeoJSON.Point | null;
    if (!p || !g || g.type !== "Point" || typeof p.time !== "string") continue;
    past.push({ time: Date.parse(p.time), lon: g.coordinates[0], lat: g.coordinates[1], windKt: typeof p.intensityKt === "number" ? p.intensityKt : null, tau: null, source: "NHC past track" });
  }
  return fullTrack(cleanTrack(past), cleanTrack(fc), storm ? { lat: storm.lat, lon: storm.lon, lastUpdate: storm.lastUpdate, intensityKt: storm.intensityKt, advisoryNumber: storm.advisoryNumber } : null);
}

export default function TimeMachine({ snap, storm, gis, tl, adv: pickedAdv, onAdv, now, onState, jump }: {
  jump?: { t: number | null; seq: number };
  snap: Snapshot | null; storm: Storm | undefined; gis: StormGis | undefined; now: number; onState: (s: SliderState | null) => void;
  tl?: StormTimeline; adv?: AdvisoryRecord | null; onAdv?: (advNum: string | null) => void;
}) {
  // Preferred: the server's unified UTC timeline (ATCF best track + official forecast). Fallback: NHC GIS shapefile points.
  const isLatest = !pickedAdv;
  const advRec = pickedAdv ?? tl?.latest ?? null;
  const track = useMemo(() => (tl && (tl.best.length || tl.latest) ? timelineTrack(tl, advRec, isLatest) : buildTrack(storm, gis)), [tl, advRec, isLatest, storm, gis]);
  const home = snap?.home ?? { lat: 25, lon: -70, name: "No location set", configured: false };
  const hasHome = !!home.configured;
  // Live = slider parked on "now" and following the clock; otherwise the user picked a fixed time.
  const [picked, setPicked] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // The big Live now / Past / Next 3 hours buttons on the map move this slider.
  useEffect(() => { if (jump && jump.seq > 0) { setPlaying(false); setPicked(jump.t); } }, [jump?.seq]);
  const liveObs = storm?.lastUpdate ? Date.parse(storm.lastUpdate) : null;
  // Slider value = a UTC timestamp over [first, last] valid time of the track (past capped at 72 h).
  const [start, end] = sliderRange(track, now);
  const live = picked == null;
  const t = live ? now : Math.min(Math.max(picked, start), end);
  const mags = useMemo(() => magnets(track.filter((p) => p.time >= start && p.time <= end), now), [track, start, end, Math.floor(now / 60_000)]);
  const choose = (raw: number) => { const v = snapTime(raw, mags, 15 * 60_000, 40 * 60_000, now); setPicked(Math.abs(v - now) < 60_000 ? null : v); };
  const st = stateAt(track, live && liveObs != null ? Math.min(liveObs, track[track.length - 1]?.time ?? liveObs) : t, home);
  if (st && live) st.time = now;
  const cpa = useMemo(() => closestApproach(track, home, now), [track, home.lat, home.lon, Math.floor(now / 60_000)]);
  const trail = useMemo(() => pathBetween(track, Math.min(now, t), Math.max(now, t)), [track, Math.floor(now / 60_000), t]);
  const coneAt = advRec ? coneCircleAt(advRec, storm?.id ?? "", live ? now : t, isLatest && liveObs != null ? liveObs : -Infinity) : null;
  const uncertaintyMi = coneAt?.radiusMi ?? 0;
  const radii = useMemo(() => radiiAt(track, live && liveObs != null ? liveObs : t), [track, t, live, liveObs]);
  const rKey = [radii.r34, radii.r50, radii.r64].map((q) => q?.map(Math.round).join(",")).join("|");
  useEffect(() => { onState(st ? { ...st, trail, uncertaintyMi, live, radii, coneTau: coneAt?.tau ?? null } : null); }, [st?.lat, st?.lon, st?.time, st?.windMph, trail.length, uncertaintyMi, live, rKey]);
  const hourly = snap?.forecast?.hourly ?? [];
  const homeHour = hourAt(hourly, t);
  const activeAlerts = alertsActiveAt(snap?.alerts ?? [], t);
  const windows = useMemo(() => adviceWindows(hourly, now, end), [hourly, Math.floor(now / 3.6e6), end]);
  // Playback on requestAnimationFrame: 4 storm-hours per real second, smooth (map sources update via setData).
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (ts: number) => {
      const dt = ts - last; last = ts;
      setPicked((p) => { const n = (p ?? now) + dt * 4 * 3.6e3; return n > end ? start : n; });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end]);

  if (!storm) return <div className="tm"><div className="tm-empty">No active storm from the National Hurricane Center right now.</div></div>;
  if (!track.length) return <div className="tm"><div className="tm-empty">Waiting for the National Hurricane Center forecast…</div></div>;
  const adv = advRec?.advNum ?? gis?.advisoryNumber ?? storm.advisoryNumber ?? null;
  const advList = (tl?.advisories ?? []).filter((a) => a.kind === "full");
  const ticks = track.filter((p) => p.time >= now && p.time <= end && p.tau != null);

  return (
    <div className="tm">
      {advList.length > 1 && onAdv && <label className="tm-adv">Forecast to show:{" "}
        <select value={adv && !isLatest ? adv : ""} onChange={(e) => { setPlaying(false); onAdv(e.target.value || null); }}>
          <option value="">Latest ({tl?.latest ? advisoryLabel(tl.latest) : "newest"})</option>
          {advList.filter((a) => a.advNum !== tl?.latest?.advNum).map((a) => <option key={a.advNum} value={a.advNum}>{advisoryLabel(a)}</option>)}
        </select>
        {!isLatest && <em className="tm-oldadv"> Showing an older forecast. The storm's real path is the solid past track.</em>}
      </label>}
      <div className="tm-time">{fmtTime(t)} {live ? <span className="tm-live">● Live</span> : t < now ? <span className="tm-now tm-pastb">PAST</span> : <span className="tm-now tm-fcb">FORECAST</span>}</div>
      <div className="tm-slider">
        <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        <input type="range" min={start} max={end} step={60_000} value={t} list="tm-magnets" className="tm-range"
          style={{ ["--now" as string]: `${Math.max(0, Math.min(100, ((now - start) / Math.max(1, end - start)) * 100)).toFixed(2)}%` }}
          onInput={(e) => { setPlaying(false); choose(Number((e.target as HTMLInputElement).value)); }}
          onChange={(e) => { setPlaying(false); choose(Number(e.target.value)); }}
          onKeyDown={(e) => {
            const k = e.key; if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(k)) return;
            e.preventDefault(); setPlaying(false);
            if (k === "Home") return setPicked(start); if (k === "End") return setPicked(end);
            if (k === "PageUp" || k === "PageDown") { const nx = k === "PageUp" ? mags.find((m) => m > t + 1000) : [...mags].reverse().find((m) => m < t - 1000); if (nx != null) choose(nx); return; }
            const dir = k === "ArrowRight" || k === "ArrowUp" ? 1 : -1;
            const nxt = Math.round(t / STEP) * STEP + dir * STEP;
            const v = Math.min(end, Math.max(start, nxt)); setPicked(Math.abs(v - now) < STEP / 2 ? null : v);
          }}
          aria-label="Pick a time: left is past, right is forecast" aria-valuetext={fmtTime(t)} />
        <datalist id="tm-magnets">{mags.map((m) => <option key={m} value={m} />)}</datalist>
        <button className={`btn ${live ? "on" : ""}`} onClick={() => { setPlaying(false); setPicked(null); }}>Back to live</button>
      </div>
      <div className="tm-scale"><span className="past">{fmtShort(start)} (past)</span><span className="now">Now</span><span className="fc">{fmtShort(end)} (forecast)</span></div>
      <div className="tm-ticks">
        {ticks.map((p) => <button key={p.time} className="btn tick" onClick={() => { setPlaying(false); setPicked(p.time); }}>{fmtShort(p.time)}</button>)}
      </div>
      {st && <>
        <div className="tm-grid">
          <div><small>Storm center</small><b>{fmtLat(st.lat)} {fmtLon(st.lon)}</b></div>
          {hasHome && <div><small>Distance from {home.name?.split(",")[0] || "home"}</small><b>{Math.round(st.distanceMi)} miles {st.bearingFromHomeCardinal}</b></div>}
          <div><small>Storm's top wind</small><b>{st.windMph ?? "—"} mph</b><em>{st.category}</em></div>
          <div><small>Storm is moving</small><b>{st.headingCardinal} {st.speedMph ? "at " + Math.round(st.speedMph) + " mph" : ""}</b></div>
        </div>
        <p className="tm-text">{hasHome ? describe(st, storm.name, adv, home.name?.split(",")[0] ?? "home") : `${storm.name} center at ${fmtLat(st.lat)} ${fmtLon(st.lon)}, top wind ${st.windMph ?? "?"} mph. Set your location in .env to see distance, winds and alerts for your place.`}</p>
        {hasHome && <><div className="tm-section">
          <h4>Wind at {home.name?.split(",")[0] || "your home"} at this time</h4>
          {homeHour ? <p className="tm-big"><b>{homeHour.windMph ?? "—"} mph</b> steady wind from the {homeHour.windDir ?? "—"}, gusts up to <b>{homeHour.gustMph ?? "—"} mph</b>. {homeHour.shortForecast}{homeHour.pop != null ? `, ${homeHour.pop}% chance of rain` : ""}.</p>
            : <p className="tm-text">Outside the National Weather Service hourly forecast for this time.</p>}
          <p className="tm-src">Source: National Weather Service hourly forecast. Hurricane-center wind probabilities are not loaded in this version.</p>
        </div>
        <div className="tm-section">
          <h4>Official alerts in effect at this time ({activeAlerts.length})</h4>
          {activeAlerts.length === 0 ? <p className="tm-text">No National Weather Service alerts in effect for your location at this time (based on current alert start and end times).</p>
            : <ul className="tm-alerts">{activeAlerts.map((a) => <li key={a.id}><b>{a.event}</b> until {fmtTime(Date.parse((a.ends ?? a.expires)!))}</li>)}</ul>}
        </div></>}
      </>}
      {windows.length > 0 && <div className="tm-section">
        <h4>What to expect, by time of day (guidance)</h4>
        <ul className="tm-windows">{windows.map((w) => {
          const on = t >= w.start && t < w.end;
          return <li key={w.start} className={`lvl-${w.level} ${on ? "on" : ""}`}><b>{fmtShort(w.start)} to {fmtShort(w.end)}:</b> {w.text}</li>;
        })}</ul>
        <p className="tm-src">Guidance built from the National Weather Service hourly forecast. Official alerts and evacuation orders always win.</p>
      </div>}
      {hasHome && cpa && <p className="tm-cpa">Closest the storm center gets to home (forecast): about {Math.round(cpa.distanceMi)} miles {cpa.bearingFromHomeCardinal} of home at {fmtTime(cpa.time)}
        <button className="btn tick" onClick={() => { setPlaying(false); setPicked(Math.round(cpa.time / STEP) * STEP); }}>show</button></p>}
      {hasHome && <p className="tm-text">Your home is {storm.inCone ? "inside" : "outside"} the National Hurricane Center's 5-day forecast cone (advisory {adv ?? "?"}).</p>}
      <p className="tm-text cone-note">{CONE_TEXT}</p>
      <p className="tm-src">Times are Eastern (ET), like NHC advisories. West of the Apalachicola River (most of the Panhandle) clocks run on Central time, 1 hour earlier. Track: NHC best track (past) and {isLatest ? "the latest official forecast" : `forecast ${adv}`}, valid times in UTC, filled in along great circles.{coneAt ? ` Ring: time-sliced cone circle, NHC 2026 radii (${Math.round(coneAt.tau)} h into the forecast, about ${Math.round(uncertaintyMi)} miles).` : ""}</p>
      <p className="tm-warn">Positions come from the National Hurricane Center forecast and are filled in between its forecast points. The further ahead, the less certain (the dashed ring on the map shows the typical error). Official forecasts and alerts always win.</p>
    </div>
  );
}
