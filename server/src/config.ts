import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ROOT = root;
export const DATA_DIR = path.join(root, "data");

/** `configured` is false when HOME_LAT / HOME_LON are not set; lat/lon are then only a neutral map center. */
export interface Home { name: string; lat: number; lon: number; configured: boolean }
/** Neutral map center (open Atlantic) used only to center the map when no location is set. Never treated as a home. */
export const NEUTRAL_CENTER = { lat: 25, lon: -70 };
export type Thresholds = {
  distanceMi: { yellow: number; orange: number; red: number };
  alertEvents: { yellow: string[]; orange: string[]; red: string[] };
  yellowOnAnyWatchOrAdvisory: boolean;
  redOnSeverityExtreme: boolean;
  allFeedsStaleMinutes: number;
  stepDownHysteresisMinutes: number;
  tsWindArrivalHoursOrange: number;
  inConeYellowMaxMi?: number;
  notify: { pressureDropMb: number; gaugeRiseFt3h: number; nearOutageMi?: number; staleFeedMinutes?: number };
  coopsStations?: string[];
  pollSeconds: Record<string, number>;
  [k: string]: unknown;
};

// Your location comes only from HOME_LAT / HOME_LON / HOME_NAME in your local .env (git-ignored).
// There is no built-in default home: if unset, the UI asks you to set one and home-based features stay off.
export function loadHome(): Home {
  const lat = Number(process.env.HOME_LAT), lon = Number(process.env.HOME_LON);
  const envOk = !!process.env.HOME_LAT && !!process.env.HOME_LON && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (envOk) return { name: process.env.HOME_NAME || "Home", lat, lon, configured: true };
  return { name: "No location set", ...NEUTRAL_CENTER, configured: false };
}
export const homeConfigured = () => loadHome().configured;
export function loadThresholds(): Thresholds {
  return JSON.parse(readFileSync(path.join(root, "config", "thresholds.json"), "utf8"));
}

export interface Landmark { name: string; lat: number; lon: number; kind: string; source?: string }
/** Public places from config/landmarks.json (invalid entries dropped; missing file = none). */
export function parseLandmarks(raw: unknown): Landmark[] {
  const list = (raw as { landmarks?: unknown })?.landmarks;
  if (!Array.isArray(list)) return [];
  return list.flatMap((x: any) => {
    const lat = Number(x?.lat), lon = Number(x?.lon);
    if (typeof x?.name !== "string" || !x.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{ name: x.name.trim().slice(0, 60), lat, lon, kind: typeof x.kind === "string" ? x.kind : "place", ...(typeof x.source === "string" ? { source: x.source } : {}) }];
  });
}
export function loadLandmarks(): Landmark[] {
  try { return parseLandmarks(JSON.parse(readFileSync(path.join(root, "config", "landmarks.json"), "utf8"))); } catch { return []; }
}

export const USER_AGENT = process.env.USER_AGENT || "Stormwatch/0.2 (self-hosted; set USER_AGENT in .env)";
export const PORT = Number(process.env.PORT || 8787);
/** Optional: your own Windy Webcams API key (free tier). Never commit it; .env only. */
export const WINDY_API_KEY = (process.env.WINDY_API_KEY ?? "").trim();
export const HOST = process.env.HOST || "localhost"; // localhost only (no LAN access)

// Optional plugins (all off by default). See docs/DATA-SOURCES.md.
/** Any public ArcGIS "query" URL that returns outage points (f=json, outSR=4326). */
export const OUTAGE_ARCGIS_URL = process.env.OUTAGE_ARCGIS_URL || "";
export const OUTAGE_ARCGIS_NAME = process.env.OUTAGE_ARCGIS_NAME || "Local utility outages";
export const OUTAGE_MAP_URL = process.env.OUTAGE_MAP_URL || "";
/** 5-digit county FIPS code for ORNL ODIN county-level outage reports (e.g. 12086). */
export const ODIN_FIPS = (process.env.ODIN_FIPS || "").trim();
