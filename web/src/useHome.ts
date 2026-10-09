import { useState } from "react";
import type { Place } from "./useSelectedPlace";

// v0.6.1 "Change home": a home picked in this browser (search or map click), saved ONLY in this browser's localStorage.
// It overrides HOME_LAT/HOME_LON in .env and the built-in default (Florida State University). Never sent anywhere
// except this app's own local server, which uses it to look up weather, alerts and outages for that point.
const KEY = "stormwatch:home";
export const FSU_HOME: Place = { name: "Florida State University", lat: 30.4422, lon: -84.2975, source: "default" };

export function loadBrowserHome(): Place | null {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? "null"); return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? p : null; } catch { return null; }
}
export function useBrowserHome() {
  const [home, setState] = useState<Place | null>(loadBrowserHome);
  const set = (p: Place | null) => {
    try { if (p) localStorage.setItem(KEY, JSON.stringify({ name: p.name, lat: p.lat, lon: p.lon, source: p.source })); else localStorage.removeItem(KEY); } catch { /* private mode */ }
    setState(p);
  };
  return [home, set] as const;
}
