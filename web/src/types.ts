/** Copy of server/src/types.ts — keep in sync. */
export interface FeedStatus {
  source: string;          // human-readable source name, e.g. "NHC CurrentStorms.json"
  url: string;
  pollSeconds: number;
  lastSuccess: string | null; // ISO time we last fetched OK
  lastAttempt: string | null;
  sourceTime: string | null;  // the source's own timestamp (advisory issuance, alert "updated", etc.)
  error: string | null;
}

export interface TsArrival {
  earliest: string | null;      // ISO; NHC "earliest reasonable" 34-kt arrival at home (estimate)
  mostLikely: string | null;    // ISO; NHC "most likely" 34-kt arrival at home (estimate)
  earliestBound: "at" | "before" | "after" | null; // "before" = no later than; "after" = edge of swath, not before
  mostLikelyBound: "at" | "before" | "after" | null;
  advisoryNumber: string | null;
}

export interface Cpa { time: string | null; distanceMi: number; receding: boolean }

export interface Storm {
  id: string;
  name: string;
  classification: string;   // TD, TS, HU, ...
  category: string;         // derived from intensityKt (Saffir-Simpson)
  intensityKt: number | null;
  pressureMb: number | null;
  lat: number;
  lon: number;
  movementDirDeg: number | null;
  movementSpeedMph: number | null;
  lastUpdate: string | null;
  advisoryNumber: string | null;
  advisoryIssuance: string | null;
  publicAdvisoryUrl: string | null;
  graphicsUrl: string | null;
  coneZipUrl: string | null;
  coneKmzUrl: string | null;
  trackKmzUrl: string | null;
  distanceMi: number;        // great-circle from home
  bearingDeg: number;        // from home to storm
  bearingCardinal: string;
  inCone: boolean | null;    // home inside the current NHC cone (null = cone not loaded)
  tsArrival: TsArrival | null;
  trackCpa: Cpa | null;      // closest approach along NHC forecast track (estimate)
  motionCpa: Cpa | null;     // closest approach if the storm kept its current motion (estimate)
  advisoryText: string | null; // verbatim NHC public advisory
}

export interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string;       // verbatim — never rewrite
  instruction: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  sent: string | null;
  senderName: string | null;
}

export interface HourlyPoint {
  time: string;
  tempF: number | null;
  windMph: number | null;
  gustMph: number | null;
  windDir: string | null;
  pop: number | null;
  shortForecast: string;
}
export interface Forecast {
  office: string | null;
  hourly: HourlyPoint[];      // next 48 h
  qpf24In: number | null;     // total forecast rain next 24 h (in)
  qpf48In: number | null;
  maxGust48Mph: number | null;
  updateTime: string | null;
}

export interface Gauge {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stageFt: number | null;
  time: string | null;
  change3hFt: number | null;
  trend: "rising" | "falling" | "steady" | "unknown";
  series: { t: string; v: number }[]; // last ~6 h, downsampled
}

export interface Buoy {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceToStormMi: number;
  time: string | null;
  windDirDeg: number | null;
  windKt: number | null;
  gustKt: number | null;
  waveFt: number | null;
  pressureMb: number | null;
  pressureTendencyMb: number | null;
}

export interface RadarFrames { host: string; frames: { time: string; path: string }[]; generated: string | null }

export interface Outage {
  lat: number; lon: number; customers: number; status: string | null; cause: string | null;
  off: string | null; etr: string | null; etrPassed: boolean; distanceMi: number; type: string | null;
}
export interface Power {
  local: { name: string; outages: Outage[]; totalCustomers: number; count: number; nearestMi: number | null } | null;
  odin: { fips: string; rows: { utility: string; customers: number; start: string | null }[]; totalCustomers: number } | null;
  links: { name: string; url: string }[];
}

export type HazardKind = "tornadoWarning" | "tornadoWatch" | "severeWatch" | "flashFloodWarning" | "flashFloodWatch";
/** A severe-weather area on the map (watch or warning). Official text fields are verbatim. */
export interface Hazard {
  id: string;
  kind: HazardKind;
  title: string;              // e.g. "Tornado Watch 677"
  plain: string;              // plain-English meaning
  onset: string | null;       // ISO
  expires: string;            // ISO
  issuer: string;             // e.g. "NWS Mobile AL"
  source: string;             // data feed name
  url: string | null;
  headline: string | null;    // verbatim NWS
  description: string | null; // verbatim NWS
  instruction: string | null; // verbatim NWS
  areaDesc?: string | null;
  geometry: GeoJSON.Geometry | null;
}
/** Hazard without geometry (sent in the snapshot; shapes come from /api/hazards). */
export type HazardSummary = Omit<Hazard, "geometry">;

export interface HudEvent { id: string; time: string; kind: string; text: string; level: "info" | "warn" | "alert" }

export type ThreatLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED" | "DATA STALE" | "SET LOCATION";

export interface Snapshot {
  version: string;           // hash of content (not feed timestamps); /ws pushes full snapshot only when it changes
  gisVersion: string;        // changes when /api/gis geometry changes
  generatedAt: string;
  home: { name: string; lat: number; lon: number; configured: boolean };
  storms: Storm[];
  alerts: NwsAlert[];
  forecast: Forecast | null;
  gauges: Gauge[];
  buoys: Buoy[];
  radar: RadarFrames | null;
  power: Power;
  threat: { level: ThreatLevel; reasons: string[]; computedLevel?: ThreatLevel; holdUntil?: string | null };
  events: HudEvent[];
  hazards: HazardSummary[];   // active SPC watches + NWS tornado / flash flood warnings and flash flood watches (no shapes)
  homeHazardIds: string[];    // hazards whose polygon contains the home point
  hazardsVersion: string;     // changes when /api/hazards geometry changes
  hazardNotes: string[];      // feed problems in plain English
  feeds: Record<string, FeedStatus>;
}

/** Geometry served by /api/gis, keyed by storm id. GeoJSON FeatureCollections. */
export interface StormGis {
  stormId: string;
  advisoryNumber: string;
  issuance: string | null;
  cone: GeoJSON.FeatureCollection | null;
  forecastLine: GeoJSON.FeatureCollection | null;
  forecastPoints: GeoJSON.FeatureCollection | null; // props: time (ISO), label, maxWindKt, gustKt, dvlbl
  watchesWarnings: GeoJSON.FeatureCollection | null; // props: type (TWA/TWR/HWA/HWR), label
  bestTrack: GeoJSON.FeatureCollection | null;       // lines + points
  toaEarliest: GeoJSON.FeatureCollection | null;     // isochrones, props: time (ISO), label
  toaMostLikely: GeoJSON.FeatureCollection | null;
}
