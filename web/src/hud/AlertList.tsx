import { useState } from "react";
import type { Snapshot } from "../types";
import Panel from "./Panel";
import { fmtET } from "../time";

const sevClass = (e: string, sev: string) => /Warning|Emergency/.test(e) || sev === "Extreme" ? "warn" : /Watch/.test(e) ? "watch" : "stmt";

/** NWS alerts for the home point. Tap for the full text, verbatim. */
export default function AlertList({ snap, area }: { snap: Snapshot | null; area?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const alerts = snap?.alerts ?? [];
  return (
    <Panel title={`Weather alerts for your home (${alerts.length})`} feed={snap?.feeds.nws} source="api.weather.gov alerts" area={area}>
      {snap && !snap.home.configured && <div className="dim">Set HOME_LAT and HOME_LON in .env to see National Weather Service alerts for your location.</div>}
      {snap?.home.configured && alerts.length === 0 && <div className="dim">No active alerts for your point.</div>}
      {alerts.map((a) => (
        <div key={a.id} className={`alert ${sevClass(a.event, a.severity)}`} onClick={() => setOpen(open === a.id ? null : a.id)}>
          <div className="alert-event">{a.event} <span className="alert-toggle">{open === a.id ? "▾" : "▸"}</span></div>
          <div className="dim">{a.severity} · {a.urgency} · until {fmtET(a.ends ?? a.expires)}</div>
          {open === a.id && <pre className="verbatim">{a.headline}{"\n\n"}{a.description}{a.instruction ? "\n\n" + a.instruction : ""}{"\n\n"}— {a.senderName ?? "NWS"}, sent {fmtET(a.sent)}</pre>}
        </div>
      ))}
    </Panel>
  );
}
