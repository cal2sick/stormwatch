import { useEffect, useState } from "react";
import type { Forecast, NwsAlert, Outage, Snapshot } from "./types";

// The "selected location" lives ONLY in this browser (localStorage). It is sent only to this app's own
// local server, which passes it to the geocoder, the National Weather Service and the outage feeds. Never logged.
export interface Place { name: string; lat: number; lon: number; source: string }
export interface PlaceWeather { forecast: Forecast | null; alerts: NwsAlert[]; office: string | null; threat?: Snapshot["threat"] }
export interface NearbyOutages {
  radiusMi: number; pollSeconds: number; checked: string; outages: (Outage & { source: string })[]; totalCustomers: number;
  feeds: { name: string; status: "ok" | "error"; count: number; credit?: string; map?: string }[];
  county: { name: string; fips: string; rows: { utility: string; customers: number }[]; source: string } | null;
  links: { name: string; url: string }[]; coverage: "point-feed" | "county-only" | "none"; note: string;
}
const KEY = "stormwatch:place";

export function loadPlace(): Place | null {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? "null"); return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null; } catch { return null; }
}

export function useSelectedPlace() {
  const [place, setPlaceState] = useState<Place | null>(loadPlace);
  const [weather, setWeather] = useState<PlaceWeather | null>(null);
  const [outages, setOutages] = useState<NearbyOutages | null>(null);
  const [outageErr, setOutageErr] = useState<string | null>(null);
  const setPlace = (p: Place | null) => {
    try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
    setWeather(null); setOutages(null); setOutageErr(null); setPlaceState(p);
  };
  const q = place ? `lat=${place.lat}&lon=${place.lon}` : null;
  // NWS hourly wind + alerts for the place: on select, then every 10 min (alerts) while selected.
  useEffect(() => {
    if (!q) return;
    let stop = false;
    const load = () => fetch(`/api/place?${q}`).then((r) => r.ok ? r.json() : null).then((d) => { if (!stop && d) setWeather(d); }).catch(() => {});
    load(); const id = setInterval(load, 10 * 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [q]);
  // Outages: poll politely (server's pollSeconds, 3 min default) and ONLY while a place is selected.
  useEffect(() => {
    if (!q) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      let next = 180;
      try {
        const r = await fetch(`/api/outages?${q}`); const d = await r.json();
        if (stop) return;
        if (r.ok) { setOutages(d); setOutageErr(null); next = Math.min(300, Math.max(180, d.pollSeconds ?? 180)); } else setOutageErr(d.error ?? "Outage data is not available right now.");
      } catch { if (!stop) setOutageErr("Outage data is not available right now."); }
      if (!stop) timer = setTimeout(load, next * 1000);
    };
    load();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [q]);
  return { place, setPlace, weather, outages, outageErr };
}
