import type { Snapshot } from "../types";
import Panel from "./Panel";
import { fmtClockET } from "../time";

const sign = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)} ft`);

/** NOAA CO-OPS coastal water levels: observed vs the predicted tide (a surge-like estimate). */
export default function TidesPanel({ snap, area }: { snap: Snapshot | null; area?: string }) {
  const t = snap?.tides ?? [];
  return (
    <Panel title="Coastal water levels (NOAA tide gauges)" feed={snap?.feeds.coops} area={area}>
      {t.length === 0 && <div className="dim">No water level readings right now.</div>}
      {t.map((x) => (
        <div key={x.id} className={`row tide-row ${x.aboveForecastFt != null && x.aboveForecastFt >= 2 ? "red" : x.aboveForecastFt != null && x.aboveForecastFt >= 1 ? "amber" : ""}`}>
          <a href={x.url} target="_blank" rel="noreferrer" className="b-id">{x.name}</a>
          <span><b>{sign(x.levelFtMhhw)}</b><small> vs normal high tide</small></span>
          <span>{sign(x.aboveForecastFt)}<small> vs predicted tide</small></span>
          <span className="dim">{x.change3hFt != null ? `${sign(x.change3hFt)} in 3 h` : ""} · {fmtClockET(x.time)}</span>
        </div>
      ))}
      <div className="dim tiny">"vs predicted tide" is roughly the storm surge right now (an estimate from NOAA readings, not the official surge forecast). Water above the normal high-tide line can flood low ground. Follow your county's evacuation orders.</div>
    </Panel>
  );
}
