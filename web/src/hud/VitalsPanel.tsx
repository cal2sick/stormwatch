import type { Snapshot, Storm } from "../types";
import ScaleReadout from "./ScaleReadout";
import Panel from "./Panel";
import { fmtDayET, rel } from "../time";
import { className, compass, ktToMph } from "../format";

const WIND_TICKS = [{ v: 34, label: "TS" }, { v: 64, label: "1" }, { v: 83, label: "2" }, { v: 96, label: "3" }, { v: 113, label: "4" }, { v: 137, label: "5" }];

/** Storm vitals + proximity: wind, pressure, range, TS-wind onset, plus closest-approach figures. */
export default function VitalsPanel({ snap, storm, now, area }: { snap: Snapshot | null; storm: Storm | undefined; now: number; area?: string }) {
  const s = storm;
  const eta = s?.tsArrival?.earliest ?? s?.tsArrival?.mostLikely ?? null;
  const etaH = eta ? (Date.parse(eta) - now) / 3_600_000 : null;
  const etaBound = s?.tsArrival?.earliest ? s.tsArrival.earliestBound : s?.tsArrival?.mostLikelyBound;
  const etaDisp = etaH == null ? "—" : etaH <= 0 ? "now" : etaH < 1 ? `${Math.round(etaH * 60)}m` : `${etaH.toFixed(etaH < 10 ? 1 : 0)}h`;
  return (
    <Panel title={s ? `${className(s.classification)} ${s.name} · vitals` : "Storm vitals"} feed={snap?.feeds.nhc} area={area}
      source={`National Hurricane Center, advisory ${Number(s?.advisoryNumber ?? 0) || s?.advisoryNumber || "—"}`} time={s?.lastUpdate ?? null}>
      {!s ? <div className="dim">No active storms in the NHC feed.</div> : <>
        <div className="readouts">
          <ScaleReadout label="Max wind" value={s.intensityKt} min={0} max={160} unit=" knots" ticks={WIND_TICKS} sub={`${ktToMph(s.intensityKt) ?? "—"} mph · ${s.category}`} alert={(s.intensityKt ?? 0) >= 64} />
          <ScaleReadout label="Min pressure" value={s.pressureMb} min={900} max={1013} invert unit=" mb" sub="lower = stronger" />
          {snap?.home.configured && <ScaleReadout label="Range to home" value={s.distanceMi} min={0} max={500} invert unit=" mi" sub={`bearing ${String(s.bearingDeg).padStart(3, "0")}° ${compass(s.bearingDeg)} · est.`} alert={s.distanceMi <= 150} />}
          <ScaleReadout label="TS-wind onset" value={etaH == null ? null : Math.max(0, etaH)} min={0} max={48} invert display={etaDisp} unit={etaBound === "after" ? " after" : etaBound === "before" ? " by" : ""}
            sub={eta ? `${etaBound === "after" ? "after " : ""}${fmtDayET(eta)} · est.` : "not forecast"} alert={etaH != null && etaH <= 12} />
        </div>
        <dl className="kv">
          <dt>Moving</dt><dd>{s.movementDirDeg != null ? `${String(s.movementDirDeg).padStart(3, "0")}° ${compass(s.movementDirDeg)}` : "—"} @ {s.movementSpeedMph ?? "—"} mph</dd>
          <dt>Cone</dt><dd className={s.inCone ? "red" : ""}>{s.inCone == null ? "—" : s.inCone ? "Your home is inside the cone" : "Your home is outside the cone"}</dd>
          <dt>Closest (forecast path)</dt><dd>{s.trackCpa ? (s.trackCpa.receding ? "moving away (forecast path)" : `${Math.round(s.trackCpa.distanceMi)} mi · ${fmtDayET(s.trackCpa.time)}`) : "—"} <span className="dim">est.</span></dd>
          <dt>Closest (current motion)</dt><dd>{s.motionCpa ? (s.motionCpa.receding ? "moving away" : `${Math.round(s.motionCpa.distanceMi)} mi · ${rel(s.motionCpa.time, now)}`) : "—"} <span className="dim">if motion holds</span></dd>
          <dt>Tropical-storm winds</dt><dd>{s.tsArrival ? <>earliest {s.tsArrival.earliestBound === "after" ? "after " : ""}{fmtDayET(s.tsArrival.earliest)} · likely {fmtDayET(s.tsArrival.mostLikely)}</> : "—"}</dd>
          <dt>Position</dt><dd>{Math.abs(s.lat).toFixed(1)}°{s.lat >= 0 ? "N" : "S"} {Math.abs(s.lon).toFixed(1)}°{s.lon >= 0 ? "E" : "W"}</dd>
        </dl>
      </>}
    </Panel>
  );
}
