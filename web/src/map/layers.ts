export type LayerKey = "cone" | "track" | "past" | "warnings" | "toa" | "radar" | "outages" | "gauges" | "buoys" | "nightlights";
export const LAYER_LABELS: Record<LayerKey, string> = {
  cone: "Forecast cone", track: "Forecast path", past: "Past path", warnings: "Watches and warnings", toa: "Tropical-storm wind arrival",
  radar: "Radar", outages: "Power outages", gauges: "Rivers", buoys: "Buoys", nightlights: "Night lights",
};
export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  cone: true, track: true, past: true, warnings: true, toa: false, radar: true, outages: true, gauges: true, buoys: true, nightlights: false,
};
