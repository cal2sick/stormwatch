import type { Snapshot } from "../types";
import { fmtClockET } from "../time";
import { plain, riskWord, RISK_MEANING } from "../plain";

const LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"] as const;

/** Compact (top bar) or full (panel) risk ladder. v0.7.1: plain words (Low / Moderate / Elevated / High), same 4 colors. */
export default function ThreatLadder({ snap, variant = "compact" }: { snap: Snapshot | null; variant?: "compact" | "full" }) {
  const level = snap?.threat.level ?? "DATA STALE";
  const reasons = (snap?.threat.reasons ?? []).map(plain);
  const why = `Your risk: ${riskWord(level)}. ${RISK_MEANING[level] ?? ""}\nWhy:\n${reasons.map((r) => `• ${r}`).join("\n")}\n\nScale: Low (green), Moderate (yellow), Elevated (orange), High (red).`;
  if (variant === "compact") {
    return (
      <div className={`ladder compact lvl-${level.replace(" ", "-").toLowerCase()}`} title={why} data-testid="risk-compact" tabIndex={0} aria-label={why}>
        {level === "DATA STALE" || level === "SET LOCATION" ? <div className="rung stale lit">{riskWord(level)}</div> :
          LEVELS.map((l) => <div key={l} className={`rung rung-${l.toLowerCase()} ${l === level ? "lit" : ""}`} aria-hidden={l !== level}>{l === level ? <>Your risk: <b>{riskWord(l)}</b></> : riskWord(l)}</div>)}
      </div>
    );
  }
  return (
    <div className={`ladder full lvl-${level.replace(" ", "-").toLowerCase()}`}>
      <div className="ladder-bars">
        {[...LEVELS].reverse().map((l) => (
          <div key={l} className={`bar rung-${l.toLowerCase()} ${l === level ? "lit" : ""} ${level === "DATA STALE" || level === "SET LOCATION" ? "dim" : ""}`}><span>{riskWord(l)}</span></div>
        ))}
      </div>
      <div className="ladder-text">
        <div className="big-level">{level === "SET LOCATION" ? "No location set" : `${riskWord(level)} risk`}</div>
        {RISK_MEANING[level] && <div className="risk-meaning">{RISK_MEANING[level]}</div>}
        {snap?.threat.holdUntil && <div className="dim">Staying at this level until at least {fmtClockET(snap.threat.holdUntil)} ET, so it doesn't flip back and forth.</div>}
        <ul className="reasons">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    </div>
  );
}
