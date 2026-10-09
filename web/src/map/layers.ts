export type LayerKey = "cone" | "track" | "past" | "warnings" | "tornado" | "flood" | "toa" | "radar" | "outages" | "gauges" | "buoys" | "nightlights" | "landmarks" | "satellite" | "cameras" | "rain";
export const LAYER_LABELS: Record<LayerKey, string> = {
  cone: "Forecast cone", track: "Forecast path", past: "Past path", warnings: "Hurricane watches and warnings",
  tornado: "Tornado watches and warnings", flood: "Flash flood warnings", toa: "Tropical-storm wind arrival",
  radar: "Radar", outages: "Power outages", gauges: "Rivers", buoys: "Buoys", nightlights: "Night lights", landmarks: "Places", satellite: "Satellite (GOES-19 infrared)", cameras: "Live cameras", rain: "Rain so far (24 hours)",
};
/** v0.7: 4 data layers on by default (storm, radar, alerts, outages) plus place names. */
export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  cone: true, track: true, past: true, warnings: true, tornado: true, flood: true, toa: false, radar: true, outages: true, gauges: false, buoys: false, nightlights: false, landmarks: true, satellite: false, cameras: false, rain: false,
};
/** v0.7 layer menu groups (one icon each). */
export const LAYER_GROUPS: { id: string; label: string; hint: string; keys: LayerKey[] }[] = [
  { id: "storm", label: "Storm path", hint: "Forecast cone, forecast path and past path (NHC)", keys: ["cone", "track", "past"] },
  { id: "radar", label: "Radar", hint: "NOAA NEXRAD radar", keys: ["radar"] },
  { id: "alerts", label: "Alerts", hint: "Hurricane, tornado and flash flood watches and warnings", keys: ["warnings", "tornado", "flood"] },
  { id: "satellite", label: "Satellite", hint: "GOES-19 infrared satellite", keys: ["satellite"] },
  { id: "rain", label: "Rain so far", hint: "Observed rain in the last 24 hours (NOAA MRMS)", keys: ["rain"] },
  { id: "wind", label: "Wind arrival", hint: "When tropical-storm-force winds may arrive (NHC)", keys: ["toa"] },
  { id: "outages", label: "Outages", hint: "Power outages", keys: ["outages"] },
  { id: "water", label: "Rivers & buoys", hint: "River gauges, tide gauges and buoys", keys: ["gauges", "buoys"] },
  { id: "cameras", label: "Cameras", hint: "Live river and coast cameras", keys: ["cameras"] },
  { id: "places", label: "Places", hint: "Place names", keys: ["landmarks"] },
  { id: "night", label: "Night lights", hint: "NASA night lights (after the storm)", keys: ["nightlights"] },
];
export const groupOn = (l: Record<LayerKey, boolean>, keys: LayerKey[]) => keys.some((k) => l[k]);

/** View modes. "hazards" shows only life-safety layers (watches, warnings, cone, path) over a plain map. */
export type ViewMode = "standard" | "hazards";
export const VIEW_LABELS: Record<ViewMode, string> = { standard: "Standard view", hazards: "Hazards view" };
export const HAZARDS_MODE_LAYERS: Partial<Record<LayerKey, boolean>> = {
  cone: true, track: true, warnings: true, tornado: true, flood: true, radar: false, outages: false, gauges: false, buoys: false, nightlights: false, toa: false, past: false, landmarks: true, satellite: false, cameras: false, rain: false,
};
export const effectiveLayers = (l: Record<LayerKey, boolean>, mode: ViewMode): Record<LayerKey, boolean> =>
  mode === "hazards" ? { ...l, ...HAZARDS_MODE_LAYERS } : { ...DEFAULT_LAYERS, ...l };
