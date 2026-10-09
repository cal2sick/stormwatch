import type { Snapshot } from "../types";
import Panel from "./Panel";
import { fmtClockET } from "../time";

export default function EventLog({ snap, area }: { snap: Snapshot | null; area?: string }) {
  const e = snap?.events ?? [];
  return (
    <Panel title="Event log" source="STORMWATCH server (derived from feeds)" time={e[0]?.time ?? null} area={area}>
      {e.length === 0 && <div className="dim">No events yet.</div>}
      {e.slice(0, 14).map((x) => <div key={x.id} className={`ev ev-${x.level}`}><span className="dim">{fmtClockET(x.time)}</span> {x.text}</div>)}
    </Panel>
  );
}
