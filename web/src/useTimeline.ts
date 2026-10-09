import { useEffect, useState } from "react";
import type { AdvisoryRecord, StormTimeline } from "./types";

/** Unified storm timelines from /api/timeline (best track + latest official forecast). Refreshed every 2 min and on new advisories. */
export function useTimeline(key: string | undefined) {
  const [tl, setTl] = useState<Record<string, StormTimeline>>({});
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/timeline").then((r) => r.json()).then((d) => { if (!stop) setTl(d); }).catch(() => {});
    load(); const id = setInterval(load, 120_000);
    return () => { stop = true; clearInterval(id); };
  }, [key]);
  return tl;
}

/** A stored advisory chosen in the advisory selector (null = latest). */
export function useAdvisory(stormId: string | undefined, advNum: string | null) {
  const [rec, setRec] = useState<AdvisoryRecord | null>(null);
  useEffect(() => {
    setRec(null);
    if (!stormId || !advNum) return;
    let stop = false;
    fetch(`/api/advisory/${encodeURIComponent(stormId)}/${encodeURIComponent(advNum)}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!stop) setRec(d); }).catch(() => {});
    return () => { stop = true; };
  }, [stormId, advNum]);
  return rec;
}
