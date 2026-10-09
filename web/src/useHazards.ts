import { useEffect, useState } from "react";
import type { Hazard } from "./types";

/** Watch / warning shapes from /api/hazards; re-fetched only when snapshot.hazardsVersion changes. */
export function useHazards(version: string | undefined) {
  const [hz, setHz] = useState<Hazard[]>([]);
  useEffect(() => {
    if (version === undefined) return;
    fetch("/api/hazards").then((r) => r.json()).then((d) => setHz(d.hazards ?? [])).catch(() => {});
  }, [version]);
  return hz;
}
