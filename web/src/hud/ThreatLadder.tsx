import type { Snapshot } from "../types";
import { fmtClockET } from "../time";

const LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"] as const;

/** Compact (top bar) or full (panel) threat ladder. DATA STALE replaces the colors entirely. */
export default function ThreatLadder({ snap, variant = "compact" }: { snap: Snapshot | null; variant?: "compact" | "full" }) {
  const level = snap?.threat.level ?? "DATA STALE";
  const reasons = snap?.threat.reasons ?? [];
  if (variant === "compact") {
    return (
      <div className={`ladder compact lvl-${level.replace(" ", "-").toLowerCase()}`}>
        <span className="ladder-label">Threat level</span>
        {level === "DATA STALE" || level === "SET LOCATION" ? <div className="rung stale lit">{level === "SET LOCATION" ? "Set your location" : "DATA STALE"}</div> :
          LEVELS.map((l) => <div key={l} className={`rung rung-${l.toLowerCase()} ${l === level ? "lit" : ""}`}>{l}</div>)}
        <div className="reason" title={reasons.join("\n")}>{reasons[0] ?? ""}{reasons.length > 1 ? `  (+${reasons.length - 1})` : ""}</div>
      </div>
    );
  }
  return (
    <div className={`ladder full lvl-${level.replace(" ", "-").toLowerCase()}`}>
      <div className="ladder-bars">
        {[...LEVELS].reverse().map((l) => (
          <div key={l} className={`bar rung-${l.toLowerCase()} ${l === level ? "lit" : ""} ${level === "DATA STALE" || level === "SET LOCATION" ? "dim" : ""}`}><span>{l}</span></div>
        ))}
      </div>
      <div className="ladder-text">
        <div className="big-level">{level === "SET LOCATION" ? "No location set" : level}</div>
        {snap?.threat.holdUntil && <div className="dim">Holding until {fmtClockET(snap.threat.holdUntil)} ET (step-down delay)</div>}
        <ul className="reasons">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    </div>
  );
}
