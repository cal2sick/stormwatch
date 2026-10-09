import { useState } from "react";
import type { Snapshot } from "../types";
import Panel from "./Panel";
import { activeAt, byUrgency, HAZARD_HEX, untilET } from "../hazards";

/** Tornado and flash flood watches/warnings in effect at the slider time, your location first. */
export default function HazardsPanel({ snap, time, area }: { snap: Snapshot | null; time: number; area?: string }) {
  const [all, setAll] = useState(false);
  const home = new Set(snap?.homeHazardIds ?? []);
  const list = byUrgency(activeAt(snap?.hazards ?? [], time)).sort((a, b) => (home.has(b.id) ? 1 : 0) - (home.has(a.id) ? 1 : 0));
  const shown = all ? list : list.slice(0, 6);
  const future = time > Date.now() + 120_000;
  return (
    <Panel title={`Tornado and flash flood alerts (${list.length})`} feed={snap?.feeds.hazards} source="NOAA Storm Prediction Center + National Weather Service" area={area}>
      {future && <div className="dim">Showing what is already issued and still in effect at the selected time. New warnings can be issued at any time.</div>}
      {list.length === 0 && <div className="dim">No tornado watches, tornado warnings or flash flood alerts in effect {future ? "at the selected time" : "right now"} in the US.</div>}
      {shown.map((h) => (
        <div key={h.id} className="hz-row" style={{ borderLeftColor: HAZARD_HEX[h.kind] }}>
          <div className="alert-event">{h.title}{home.has(h.id) ? <b className="red"> · covers your location</b> : ""}</div>
          <div>{h.plain}</div>
          <div className="dim">Until {untilET(h.expires)} · {h.issuer}{h.areaDesc ? ` · ${h.areaDesc.slice(0, 120)}${h.areaDesc.length > 120 ? "…" : ""}` : ""}</div>
        </div>
      ))}
      {list.length > 6 && <button className="btn" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>}
      {(snap?.hazardNotes ?? []).map((n) => <div key={n} className="dim">Note: {n}</div>)}
    </Panel>
  );
}
