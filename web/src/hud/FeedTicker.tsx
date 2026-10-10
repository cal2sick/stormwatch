import { useState } from "react";
import type { Snapshot } from "../types";
import { fmtClockET, staleness } from "../time";
import { plain } from "../plain";

/** Bottom status bar. v0.7.1: one plain summary line ("All 14 data sources up to date"); the per-source list opens on demand. */
export default function FeedTicker({ snap, now }: { snap: Snapshot | null; now: number }) {
  const [open, setOpen] = useState(false);
  const feeds = Object.entries(snap?.feeds ?? {});
  const st = feeds.map(([k, f]) => ({ k, f, s: staleness(f.lastSuccess, f.pollSeconds, now) }));
  const late = st.filter((x) => x.s !== "fresh" || x.f.error);
  const newest = st.map((x) => x.f.lastSuccess).filter(Boolean).sort().at(-1) ?? null;
  return (
    <div className={`ticker ${open ? "open" : ""}`} data-testid="ticker">
      <span className="tk-safety">For information only. Follow official warnings and evacuation orders.</span>
      {feeds.length === 0 ? <span className="stale-red">Waiting for the first data…</span> : <>
        <span className={`tk-sum ${late.length ? "stale-amber" : "stale-fresh"}`}>
          <i className="led" />{late.length === 0 ? `All ${feeds.length} data sources up to date` : `${late.length} of ${feeds.length} data sources are late: ${late.map((x) => plain(x.f.source)).join(", ")}`}
          {newest ? ` · last checked ${fmtClockET(newest)} ET` : ""}
        </span>
        <button className="tk-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="ticker-toggle">{open ? "Hide sources ▾" : "Show sources ▴"}</button>
        {open && <div className="tk-list">{st.map(({ k, f, s }) => (
          <span key={k} className={`feed stale-${s}`} title={f.error ?? f.url}>
            ● {plain(f.source)} <i>{f.sourceTime ? `data from ${fmtClockET(f.sourceTime)} ET, ` : ""}checked {fmtClockET(f.lastSuccess)} ET</i>{f.error ? " · error, showing the last good data" : ""}
          </span>))}</div>}
      </>}
    </div>
  );
}
