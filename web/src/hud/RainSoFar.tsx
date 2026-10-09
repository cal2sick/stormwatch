import { useEffect, useState } from "react";
import { fmtET } from "../time";

export interface RainTotals { p1h: RT; p24h: RT; p72h: RT; source: string; checked: string }
interface RT { inches: number | null; start: string | null; end: string | null }

/** Rain color by inches (same steps as the map key). */
export const rainColor = (inch: number | null) => inch == null ? "#6c7d8f" : inch < 0.1 ? "#9aabbd" : inch < 1 ? "#00fe12" : inch < 2 ? "#fefe00" : inch < 3 ? "#fe9000" : inch < 6 ? "#fe0000" : "#fe00fe";
export function useRain(lat: number | null, lon: number | null) {
  const [d, setD] = useState<RainTotals | null>(null); const [err, setErr] = useState(false);
  useEffect(() => {
    setD(null); setErr(false); if (lat == null || lon == null) return;
    let stop = false;
    const load = () => fetch(`/api/rain?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`).then((r) => r.ok ? r.json() : Promise.reject()).then((j) => { if (!stop) setD(j); }).catch(() => { if (!stop) setErr(true); });
    load(); const id = setInterval(load, 15 * 60_000); return () => { stop = true; clearInterval(id); };
  }, [lat?.toFixed(3), lon?.toFixed(3)]);
  return { d, err };
}

/** v0.7 "Rain so far": observed 1 h / 24 h / 72 h totals for one point. */
export default function RainSoFar({ lat, lon, compact = false }: { lat: number; lon: number; compact?: boolean }) {
  const { d, err } = useRain(lat, lon);
  const cell = (label: string, t: RT | undefined) => <div style={{ ["--rc" as string]: rainColor(t?.inches ?? null) }}>
    <span>{label}</span><b className="num">{!d ? "…" : t?.inches == null ? "n/a" : t.inches.toFixed(2)}<small>{t?.inches != null ? " in" : ""}</small></b></div>;
  return (
    <div className={`rain-sofar ${compact ? "compact" : ""}`} data-testid="rain-sofar">
      <div className="rs-title">Rain so far (observed)</div>
      {err ? <p className="tm-text">Rain totals are not available right now.</p> : <div className="rs-grid">{cell("Last hour", d?.p1h)}{cell("24 hours", d?.p24h)}{cell("72 hours", d?.p72h)}</div>}
      {d && <small className="tc-src">NOAA MRMS radar + gauges via Iowa Environmental Mesonet · through {fmtET(d.p24h.end ?? d.p1h.end)}</small>}
    </div>
  );
}
