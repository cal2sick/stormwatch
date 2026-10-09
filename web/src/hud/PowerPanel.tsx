import type { Snapshot } from "../types";
import Panel from "./Panel";
import { fmtClockET, fmtET } from "../time";
import OutageSummary from "./OutageSummary";
import type { OutageAreas } from "../outages";

/** Power: optional live outage plugins (off by default) plus link-outs. See docs/DATA-SOURCES.md. */
export default function PowerPanel({ snap, area, areas = null, now }: { snap: Snapshot | null; area?: string; areas?: OutageAreas | null; now?: number }) {
  const c = snap?.power.local, o = snap?.power.odin;
  return (
    <Panel title="Power outages" feed={snap?.feeds.power ?? snap?.feeds.odin} source={c ? `${c.name} (as of fetch)` : "links only (no live outage feed configured)"} area={area}>
      <OutageSummary areas={areas} point={snap?.home.configured ? { lat: snap.home.lat, lon: snap.home.lon } : null} placeName={snap?.home.configured ? snap.home.name : null} now={now} />
      {c && <div className="big-stats">
        <div><b className={c.totalCustomers > 0 ? "hot" : ""}>{c.totalCustomers}</b><span>Customers without power</span></div>
        <div><b>{c.count}</b><span>Outages</span></div>
        <div><b>{c.nearestMi ?? "—"}</b><span>Nearest (miles)</span></div>
      </div>}
      {(c?.outages ?? []).slice(0, 4).map((x, i) => (
        <div key={i} className="row">
          <span>{x.distanceMi} mi · {x.customers} customers · {x.status ?? ""}</span>
          <span className="dim">since {fmtClockET(x.off)} · estimated fix {fmtClockET(x.etr)}{x.etrPassed ? <b className="warn-txt"> PASSED</b> : ""}</span>
        </div>
      ))}
      {o && <div className="row"><span>County {o.fips} (ORNL ODIN): {o.totalCustomers} meters out ({o.rows.length} reports)</span><span className="dim">{fmtET(snap?.feeds.odin?.sourceTime)}</span></div>}
      <div className="links">
        {(snap?.power.links ?? []).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">↗ {l.name}</a>)}
      </div>
      {!c && <div className="dim tiny">Check your own utility's outage map. To show live outages here, see docs/DATA-SOURCES.md (optional plugins).</div>}
    </Panel>
  );
}
