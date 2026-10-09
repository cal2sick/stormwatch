import type { ReactNode } from "react";
import type { FeedStatus } from "../types";
import { fmtET, staleness } from "../time";

/**
 * Every panel shows its source + the source's own ET timestamp + a stale color (AGENTS.md rule 1).
 * Pass `feed` (preferred) or explicit `source`/`time`.
 */
export default function Panel({ title, feed, source, time, area, children, right, className = "" }: {
  title: string; feed?: FeedStatus | null; source?: string; time?: string | null; area?: string;
  children: ReactNode; right?: ReactNode; className?: string;
}) {
  const st = feed ? staleness(feed.lastSuccess, feed.pollSeconds) : "fresh";
  return (
    <section className={`panel ${className}`} data-area={area}>
      <header className="panel-head">
        <span className="panel-title">{title}</span>
        {right}
      </header>
      <div className="panel-body">{children}</div>
      <footer className={`src stale-${st}`} title={feed?.error ?? (feed ? `fetched ${fmtET(feed.lastSuccess)}` : "")}>
        <span className="led" />SRC {source ?? feed?.source ?? "—"} · {fmtET(time !== undefined ? time : feed?.sourceTime)}
        {st !== "fresh" && <b className="stale-tag">{st === "amber" ? " · STALE" : " · STALE >6×"}</b>}
        {feed?.error && <b className="err-tag"> ERR</b>}
      </footer>
    </section>
  );
}
