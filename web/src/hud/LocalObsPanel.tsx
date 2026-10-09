import type { Snapshot } from "../types";
import Panel from "./Panel";
import { cardinal } from "../track";

/** Latest reading at the nearest NWS weather station to your location. */
export default function LocalObsPanel({ snap, area }: { snap: Snapshot | null; area?: string }) {
  const o = snap?.localObs;
  if (!snap?.home.configured) return null;
  return (
    <Panel title={o ? `Right now at ${o.stationName} (${o.stationId})` : "Right now at the nearest weather station"} feed={snap?.feeds.obs} area={area}>
      {!o ? <div className="dim">Waiting for the National Weather Service station reading…</div> : <p className="tm-big">
        <b>{o.windMph ?? "—"} mph</b> wind{o.windDirDeg != null ? ` from the ${cardinal(o.windDirDeg)}` : ""}{o.gustMph ? <>, gusts <b>{o.gustMph} mph</b></> : ""}
        {o.tempF != null ? `, ${o.tempF}°F` : ""}{o.text ? `, ${o.text.toLowerCase()}` : ""}{o.rainLastHourIn ? `, ${o.rainLastHourIn} in of rain last hour` : ""}
        {o.pressureMb ? `, pressure ${o.pressureMb} mb` : ""}. <a href={o.url} target="_blank" rel="noreferrer">history</a>
      </p>}
    </Panel>
  );
}
