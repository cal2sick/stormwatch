import type { Snapshot } from "../types";
import Panel from "./Panel";
import { fmtHourET } from "../time";

/** Next 24 h: wind + gust bars, rain chance, from the NWS gridpoint forecast. */
export default function HourlyStrip({ snap, area }: { snap: Snapshot | null; area?: string }) {
  const f = snap?.forecast;
  const hrs = f?.hourly.slice(0, 24) ?? [];
  const max = Math.max(40, ...hrs.map((h) => h.gustMph ?? h.windMph ?? 0));
  const W = 24 * 22, H = 110;
  return (
    <Panel title={`Local forecast (National Weather Service ${f?.office ?? ""})`} feed={snap?.feeds.forecast} area={area}>
      <div className="stat-row"><b>{f?.maxGust48Mph ?? "—"}</b> mph strongest gust in the next 2 days · <b>{f?.qpf24In ?? "—"}</b>″ rain in the next day · <b>{f?.qpf48In ?? "—"}</b>″ in 2 days</div>
      {hrs.length === 0 ? <div className="dim">No forecast yet.</div> : (
        <svg viewBox={`0 0 ${W} ${H + 28}`} className="hourly">
          {[0.25, 0.5, 0.75].map((k) => <line key={k} x1={0} x2={W} y1={H - H * k} y2={H - H * k} stroke="#1c2420" />)}
          {hrs.map((h, i) => {
            const x = i * 22 + 4, wh = ((h.windMph ?? 0) / max) * H, gh = ((h.gustMph ?? 0) / max) * H, ph = ((h.pop ?? 0) / 100) * 18;
            return (
              <g key={h.time}>
                <title>{`${fmtHourET(h.time)} ET: ${h.windDir ?? ""} ${h.windMph ?? "?"} mph, gust ${h.gustMph ?? "?"} mph, rain ${h.pop ?? "?"}%, ${h.shortForecast}`}</title>
                {h.gustMph != null && <rect x={x} y={H - gh} width={14} height={gh} fill="none" stroke="#c8cfc6" strokeOpacity=".55" />}
                <rect x={x + 2} y={H - wh} width={10} height={wh} fill="#7fae8c" fillOpacity=".85" />
                <rect x={x} y={H + 4 + (18 - ph)} width={14} height={ph} fill="#56636b" fillOpacity=".9" />
                {i % 3 === 0 && <text x={x + 7} y={H + 26} textAnchor="middle" className="axis">{fmtHourET(h.time)}</text>}
                {i % 3 === 0 && <text x={x + 7} y={H - gh - 3} textAnchor="middle" className="axis v">{h.gustMph ?? h.windMph ?? ""}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <div className="legend-row"><i className="sw c" />wind <i className="sw a" />gust <i className="sw b" />rain chance · hours ET · mph</div>
    </Panel>
  );
}
