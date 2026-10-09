// Severe-weather hazard polygons: tornado / severe watches (SPC), tornado warnings and flash flood
// warnings / watches (NWS). Filled faintly, outlined boldly, labelled with title + expiry in ET.
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { HazardFC } from "../hazards";

export const HAZARD_LAYER_IDS = ["hz-fill", "hz-line", "hz-label"];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function addHazardLayers(m: MlMap) {
  m.addSource("hazards", { type: "geojson", data: EMPTY });
  const warn = ["in", ["get", "kind"], ["literal", ["tornadoWarning", "flashFloodWarning"]]];
  m.addLayer({ id: "hz-fill", type: "fill", source: "hazards", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", warn, 0.28, 0.1] } as any });
  m.addLayer({ id: "hz-line", type: "line", source: "hazards", paint: { "line-color": ["get", "color"], "line-width": ["case", warn, 3, 2] } as any });
  m.addLayer({ id: "hz-label", type: "symbol", source: "hazards", layout: {
    "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 13, "symbol-placement": "point", "text-max-width": 14 },
    paint: { "text-color": ["get", "color"], "text-halo-color": "#070909", "text-halo-width": 2 } as any });
}

export function updateHazardLayers(m: MlMap, data: HazardFC) {
  (m.getSource("hazards") as GeoJSONSource | undefined)?.setData(data as GeoJSON.FeatureCollection);
}
