import { ktToMph } from "../format";
import type { Snapshot } from "../types";
import Panel from "./Panel";
import { fmtClockET } from "../time";

/** NDBC buoys nearest the storm center. */
export default function BuoysPanel({ snap, area }: { snap: Snapshot | null; area?: string }) {
  const b = snap?.buoys ?? [];
  return (
    <Panel title="Gulf buoys (NOAA)" feed={snap?.feeds.ndbc} area={area}>
      {b.length === 0 && <div className="dim">No reporting buoys near the storm.</div>}
      {b.map((x) => (
        <div key={x.id} className="row buoy-row" title={x.name}>
          <span className="b-id">{x.id}<i className="dim"> {x.distanceToStormMi} mi</i></span>
          <span>{ktToMph(x.windKt) ?? "—"}<small> mph</small>, gusts {ktToMph(x.gustKt) ?? "—"}</span>
          <span>{x.pressureMb ?? "—"}<small>mb</small></span>
          <span>{x.waveFt ?? "—"}<small>ft</small></span>
          <span className="dim">{fmtClockET(x.time)}</span>
        </div>
      ))}
      <div className="dim tiny">Wind and gusts (mph), air pressure (millibars), wave height (feet), time measured (ET), distance from the storm center.</div>
    </Panel>
  );
}
