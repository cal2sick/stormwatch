import { useEffect, useState } from "react";
/** Re-render every `ms` so staleness colors and countdowns stay current. */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
