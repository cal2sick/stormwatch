export type LayerKey = "cone" | "track" | "past" | "warnings" | "tornado" | "flood" | "toa" | "radar" | "outages" | "gauges" | "buoys" | "nightlights";
export const LAYER_LABELS: Record<LayerKey, string> = {
  cone: "Forecast cone", track: "Forecast path", past: "Past path", warnings: "Hurricane watches and warnings",
  tornado: "Tornado watches and warnings", flood: "Flash flood warnings", toa: "Tropical-storm wind arrival",
  radar: "Radar", outages: "Power outages", gauges: "Rivers", buoys: "Buoys", nightlights: "Night lights",
};
export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  cone: true, track: true, past: true, warnings: true, tornado: true, flood: true, toa: false, radar: true, outages: true, gauges: true, buoys: true, nightlights: false,
};

/** View modes. "hazards" shows only life-safety layers (watches, warnings, cone, path) over a plain map. */
export type ViewMode = "standard" | "hazards";
export const VIEW_LABELS: Record<ViewMode, string> = { standard: "Standard view", hazards: "Hazards view" };
export const HAZARDS_MODE_LAYERS: Partial<Record<LayerKey, boolean>> = {
  cone: true, track: true, warnings: true, tornado: true, flood: true, radar: false, outages: false, gauges: false, buoys: false, nightlights: false, toa: false, past: false,
};
export const effectiveLayers = (l: Record<LayerKey, boolean>, mode: ViewMode): Record<LayerKey, boolean> =>
  mode === "hazards" ? { ...l, ...HAZARDS_MODE_LAYERS } : { ...DEFAULT_LAYERS, ...l };
