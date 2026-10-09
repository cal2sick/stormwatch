import { useEffect, useState } from "react";
import type { OutageAreas } from "./outages";

/** Utility-wide outage totals, shapes and 24 h history from our own server (no location sent). Every 3 minutes. */
export function useOutageAreas(): OutageAreas | null {
  const [d, setD] = useState<OutageAreas | null>(null);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const r = await fetch("/api/outage-areas"); if (r.ok) { const j = await r.json(); if (!stop) setD(j); } } catch { /* keep last good */ }
      if (!stop) timer = setTimeout(load, 180_000);
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  return d;
}
