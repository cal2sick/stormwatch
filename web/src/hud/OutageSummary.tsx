import { compareUrl, fmtPct, headlineFor, minutesAgo, OUTAGE_COLORS, OUTAGE_STOPS, sparkPoints, sumSeries, trend, utilitiesFor, type OutageAreas } from "../outages";
import { fmtClockET, fmtET } from "../time";

/** One shared ramp, used by the map and the panels. */
export function OutageRamp() {
  return (
    <div className="out-ramp" data-testid="outage-legend" aria-label="Percent of customers without power">
      <span className="out-ramp-t">% of customers out</span>
      <span className="out-ramp-bar">{OUTAGE_COLORS.slice(0, 4).map((c) => <i key={c} style={{ background: c }} />)}</span>
      <span className="out-ramp-l">{OUTAGE_STOPS.map((s) => <b key={s}>{s}%</b>)}</span>
    </div>
  );
}

/** Headline + 24 h sparkline + per-utility table + compare link, for the selected place (or home, or everything). */
export default function OutageSummary({ areas, point, placeName, fips, now = Date.now() }: {
  areas: OutageAreas | null; point: { lat: number; lon: number } | null; placeName: string | null; fips?: string | null; now?: number;
}) {
  if (!areas) return <p className="tm-text">Loading utility outage totals…</p>;
  const h = headlineFor(areas.utilities, point, placeName);
  const rows = utilitiesFor(areas.utilities, point);
  const pts = sumSeries(areas.history.series, h?.ids ?? []);
  const tr = trend(pts, now);
  const stale = h?.sourceTime ? now - Date.parse(h.sourceTime) > 15 * 60_000 : false;
  return (
    <div className="out-sum" data-testid="outage-summary">
      {h && h.out != null ? <div className="out-head" data-testid="outage-headline">
        <div className="out-big"><b className={h.out > 0 ? "hot" : ""}>{h.out.toLocaleString()}</b><span>customers out</span></div>
        <div className="out-big"><b>{fmtPct(h.pct)}</b><span>of {h.served ? `${h.served.toLocaleString()} customers` : "customers (total unknown)"}</span></div>
        <div className="out-meta">
          <div>{h.label}</div>
          <div className={stale ? "warn-txt" : "dim"}>{minutesAgo(h.sourceTime, now)} · {fmtClockET(h.sourceTime)} ET{stale ? " · OUT OF DATE" : ""}</div>
          {h.partial.length > 0 && <div className="dim">Not counted (no free live feed): {h.partial.join(", ")}</div>}
        </div>
      </div> : <p className="tm-text" data-testid="outage-headline">{h ? `No free live outage feed covers ${h.label}. ` : "No outage feed covers this place. "}Check the utility maps below.</p>}
      {h && h.ids.length > 0 && <div className="out-spark" data-testid="outage-sparkline">
        {pts.length > 1 && <svg viewBox="0 0 240 40" width="100%" height="40" preserveAspectRatio="none" role="img" aria-label={`Customers out, last 24 hours${tr.peak != null ? `, peak ${tr.peak}` : ""}`}>
          <line x1="0" y1="39" x2="240" y2="39" className="axis" />
          <polyline points={sparkPoints(pts, 240, 40, now)} />
        </svg>}
        <div className="dim tiny">{pts.length > 1
          ? <>Last 24 hours (our own checks every few minutes, {pts.length} so far) · peak {tr.peak?.toLocaleString()} at {fmtClockET(new Date(tr.peakAt!).toISOString())} ET{tr.dir ? <> · <b className={tr.dir === "rising" ? "warn-txt" : ""}>{tr.dir === "rising" ? "↑ rising" : tr.dir === "restoring" ? "↓ restoring" : "→ steady"}</b> (was {tr.hourAgo?.toLocaleString()} an hour ago)</> : null}</>
          : "24-hour history starts now: the app saves a total every few minutes while it runs (data/outage-history.jsonl)."}</div>
      </div>}
      <table className="out-table" data-testid="outage-table">
        <thead><tr><th>Utility (source)</th><th>Out</th><th>Served*</th><th>% out</th><th>Est. restore</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={r.kind}>
            <td>{r.map ? <a href={r.map} target="_blank" rel="noreferrer">{r.name} ↗</a> : r.name}
              <small className="dim out-src">{r.kind === "live" ? (r.out != null ? `live utility feed, ${fmtClockET(r.sourceTime)} ET` : r.note) : "no free live feed (link only)"}</small></td>
            <td>{r.out != null ? r.out.toLocaleString() : "—"}</td>
            <td title={r.servedSource ?? ""}>{r.served ? `${r.served.toLocaleString()}` : "—"}</td>
            <td>{fmtPct(r.pct)}</td>
            <td>{r.kind !== "live" || r.out == null ? "—" : r.etr ? `latest ${fmtET(r.etr)}` : r.outages ? <span className="warn-txt" title="The utility's estimated restore time has already passed for these outages">{r.etrPassed}/{r.outages} past estimate</span> : "—"}</td>
          </tr>))}</tbody>
      </table>
      <p className="tm-src">* Served = the utility's total Florida customers from the U.S. Energy Information Administration (Form EIA-861, 2024 data), not just this county, so % out is for the whole utility. {areas.regionNote ? "Map: Tallahassee regions are shaded by their share of all City of Tallahassee Utilities customers." : ""}</p>
      <p className="tm-text"><a href={compareUrl(fips, areas.compare)} target="_blank" rel="noreferrer" data-testid="compare-pous">Compare on PowerOutage.us ↗</a> <span className="dim tiny">(link only; their numbers are not used here)</span></p>
    </div>
  );
}
