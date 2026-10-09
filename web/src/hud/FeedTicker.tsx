import type { Snapshot } from "../types";
import { fmtClockET, staleness } from "../time";

/** Bottom status bar: every feed's source time, fetch time, and stale color. */
export default function FeedTicker({ snap, now }: { snap: Snapshot | null; now: number }) {
  const feeds = Object.entries(snap?.feeds ?? {});
  return (
    <div className="ticker">
      {feeds.length === 0 && <span className="stale-red">NO FEEDS YET</span>}
      {feeds.map(([k, f]) => (
        <span key={k} className={`feed stale-${staleness(f.lastSuccess, f.pollSeconds, now)}`} title={f.error ?? f.url}>
          ● {f.source} <i>data from {fmtClockET(f.sourceTime)}, checked {fmtClockET(f.lastSuccess)}</i>{f.error ? " · error" : ""}
        </span>
      ))}
    </div>
  );
}
