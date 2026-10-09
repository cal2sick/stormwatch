import type { Snapshot } from "../types";
import Panel from "./Panel";
import { fmtClockET } from "../time";

const short = (n: string) => n.replace(/,? ?FLA?\.?$/i, "").replace(/ NEAR | NR /i, " @ ").replace(/RIVER/i, "R.").slice(0, 30);
function Spark({ pts }: { pts: { v: number }[] }) {
  if (pts.length < 2) return <svg className="spark" />;
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), r = hi - lo || 1;
  const d = vs.map((v, i) => `${(i / (vs.length - 1)) * 60},${16 - ((v - lo) / r) * 14}`).join(" ");
  return <svg className="spark" viewBox="0 0 60 18"><polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>;
}

/** USGS river gauges in a box around your location: stage, 3 h change, trend, 6 h sparkline. */
export default function RiversPanel({ snap, area }: { snap: Snapshot | null; area?: string }) {
  const g = snap?.gauges ?? [];
  return (
    <Panel title={`River levels (USGS, ${g.length})`} feed={snap?.feeds.usgs} area={area}>
      {g.length === 0 && <div className="dim">No gauge data yet.</div>}
      {g.map((x) => (
        <div key={x.id} className={`row gauge-row t-${x.trend}`} title={`${x.name} · USGS ${x.id} · ${fmtClockET(x.time)} ET`}>
          <span className="g-name">{short(x.name)}</span>
          <Spark pts={x.series} />
          <span className="g-val">{x.stageFt?.toFixed(2) ?? "—"} ft</span>
          <span className="g-chg">{x.trend === "rising" ? "▲" : x.trend === "falling" ? "▼" : "■"} {x.change3hFt == null ? "—" : (x.change3hFt > 0 ? "+" : "") + x.change3hFt.toFixed(2)}</span>
        </div>
      ))}
      <div className="dim tiny">Change over 3 h. Flood stages: see water.noaa.gov (not in this feed).</div>
    </Panel>
  );
}
