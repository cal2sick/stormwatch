import { useEffect, useState } from "react";
import type { StormGis } from "./types";

/** Storm geometry from /api/gis; re-fetched only when the server's gisVersion changes. */
export function useGis(gisVersion: string | undefined) {
  const [gis, setGis] = useState<Record<string, StormGis>>({});
  useEffect(() => {
    if (gisVersion === undefined) return;
    fetch("/api/gis").then((r) => r.json()).then(setGis).catch(() => {});
  }, [gisVersion]);
  return gis;
}
