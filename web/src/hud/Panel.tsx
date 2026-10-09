import { useState, type ReactNode } from "react";
import type { FeedStatus } from "../types";
import { fmtET, staleness } from "../time";

/**
 * Every panel shows its source + the source's own ET timestamp + a stale color (AGENTS.md rule 1).
 * Pass `feed` (preferred) or explicit `source`/`time`.
 */
/** v0.7: cards collapse (tap the title); the choice is remembered per card on this device. */
/** Detail cards that start folded (the top bar and map already show their headline). */
const DEFAULT_COLLAPSED = new Set(["obs", "hazards", "threat", "place"]);
function useCollapsed(area: string | undefined, init: boolean) {
  const key = `stormwatch:card:${area ?? ""}`;
  const [c, setC] = useState(() => { try { const v = localStorage.getItem(key); return v == null ? init : v === "1"; } catch { return init; } });
  const toggle = () => setC((x) => { try { localStorage.setItem(key, x ? "0" : "1"); } catch { /* ignore */ } return !x; });
  return [c, toggle] as const;
}

export default function Panel({ title, feed, source, time, area, children, right, className = "", collapsed: startCollapsed = false, icon }: {
  title: string; feed?: FeedStatus | null; source?: string; time?: string | null; area?: string;
  children: ReactNode; right?: ReactNode; className?: string; collapsed?: boolean; icon?: ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(area, startCollapsed || DEFAULT_COLLAPSED.has(area ?? ""));
  const st = feed ? staleness(feed.lastSuccess, feed.pollSeconds) : "fresh";
  return (
    <section className={`panel ${className} ${collapsed ? "collapsed" : ""}`} data-area={area}>
      <header className="panel-head">
        <button className="panel-title" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? "Show" : "Hide"}>
          {icon && <span className="panel-icon">{icon}</span>}<span className="pt-text">{title}</span><span className="chev" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        </button>
        {!collapsed && right}
      </header>
      {!collapsed && <div className="panel-body">{children}</div>}
      {!collapsed && <footer className={`src stale-${st}`} title={feed?.error ?? (feed ? `fetched ${fmtET(feed.lastSuccess)}` : "")}>
        <span className="led" />SRC {source ?? feed?.source ?? "—"} · {fmtET(time !== undefined ? time : feed?.sourceTime)}
        {st !== "fresh" && <b className="stale-tag">{st === "amber" ? " · STALE" : " · STALE >6×"}</b>}
        {feed?.error && <b className="err-tag"> ERR</b>}
      </footer>}
    </section>
  );
}
