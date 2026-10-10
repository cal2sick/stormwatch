// NHC storm geometry layers: cone (faint fill + thin dashed outline), forecast track + labelled points,
// past track trail, watch/warning coast segments, TS-wind arrival isochrones.
import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { StormGis } from "../types";
import { fmtDayET } from "../time";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
export const WW_HEX = { HWR: "#d23c34", HWA: "#b77aa6", TWR: "#5f86b8", TWA: "#c2ad5c" };
const WW_COLOR = ["match", ["get", "type"], "HWR", WW_HEX.HWR, "HWA", WW_HEX.HWA, "TWR", WW_HEX.TWR, "TWA", WW_HEX.TWA, "#c8cfc6"];
export const STORM_LAYER_IDS: Record<string, string[]> = {
  cone: ["cone-fill", "cone-line"], track: ["fcst-line", "fcst-pts", "fcst-labels"], past: ["best-line", "best-pts"],
  warnings: ["ww-line"], toa: ["toa-line", "toa-labels"],
};

export function addStormLayers(m: MlMap) {
  for (const id of ["cone", "fcstLine", "fcstPts", "ww", "best", "toa"]) m.addSource(id, { type: "geojson", data: EMPTY });
  m.addLayer({ id: "cone-fill", type: "fill", source: "cone", paint: { "fill-color": "#c8cfc6", "fill-opacity": 0.07 } });
  m.addLayer({ id: "cone-line", type: "line", source: "cone", paint: { "line-color": "#c8cfc6", "line-width": 1, "line-dasharray": [4, 3] } });
  m.addLayer({ id: "toa-line", type: "line", source: "toa", paint: { "line-color": "#7fae8c", "line-width": 1, "line-opacity": 0.7, "line-dasharray": [1, 2] } });
  m.addLayer({ id: "toa-labels", type: "symbol", source: "toa", layout: { "symbol-placement": "line", "text-field": ["get", "etLabel"], "text-font": ["Noto Sans Regular"], "text-size": 10 }, paint: { "text-color": "#7fae8c", "text-halo-color": "#070909", "text-halo-width": 1.5 } });
  m.addLayer({ id: "ww-line", type: "line", source: "ww", paint: { "line-color": WW_COLOR as any, "line-width": 3 } });
  m.addLayer({ id: "best-line", type: "line", source: "best", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round" },
    paint: { "line-color": "#8b938d", "line-width": 1.2, "line-opacity": 0.8 } });
  m.addLayer({ id: "best-pts", type: "circle", source: "best", filter: ["==", ["get", "kind"], "point"],
    paint: { "circle-radius": 2, "circle-color": "#8b938d", "circle-opacity": ["coalesce", ["get", "fade"], 0.6] } });
  m.addLayer({ id: "fcst-line", type: "line", source: "fcstLine", paint: { "line-color": "#e4e8e2", "line-width": 1, "line-opacity": 0.9, "line-dasharray": [2, 2] } });
  m.addLayer({ id: "fcst-pts", type: "circle", source: "fcstPts", paint: {
    "circle-radius": 3.5, "circle-color": ["step", ["coalesce", ["get", "maxWindKt"], 0], "#070909", 64, "#d23c34"],
    "circle-stroke-color": "#e4e8e2", "circle-stroke-width": 1 } });
  m.addLayer({ id: "fcst-labels", type: "symbol", source: "fcstPts", layout: {
    "text-field": ["get", "etLabel"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.8,
    "text-allow-overlap": false, "text-optional": true, "text-padding": 4, "symbol-sort-key": 20 },
    paint: { "text-color": "#e4e8e2", "text-halo-color": "#04070b", "text-halo-width": 2 } });
}

/** Push the selected storm's GIS into the map sources. Labels are converted to ET on the client. */
export function updateStormLayers(m: MlMap, g: StormGis | undefined) {
  const set = (id: string, fc: GeoJSON.FeatureCollection | null | undefined) => (m.getSource(id) as GeoJSONSource | undefined)?.setData(fc ?? EMPTY);
  set("cone", g?.cone);
  set("fcstLine", g?.forecastLine);
  set("fcstPts", g?.forecastPoints ? { ...g.forecastPoints, features: g.forecastPoints.features.map((f) => ({
    ...f, properties: { ...f.properties, etLabel: `${fmtDayET((f.properties as any).time).replace(" ET", "")} · ${(f.properties as any).maxWindKt != null ? Math.round((f.properties as any).maxWindKt * 1.15078 / 5) * 5 : "?"} mph` } })) } : null);
  set("ww", g?.watchesWarnings);
  const best = g?.bestTrack;
  if (best) {
    const pts = best.features.filter((f) => (f.properties as any).kind === "point");
    set("best", { ...best, features: best.features.map((f) => {
      const i = pts.indexOf(f);
      return i < 0 ? f : { ...f, properties: { ...f.properties, fade: 0.15 + 0.75 * (i / Math.max(1, pts.length - 1)) } };
    }) });
  } else set("best", null);
  set("toa", g?.toaMostLikely ? { ...g.toaMostLikely, features: g.toaMostLikely.features.map((f) => ({
    ...f, properties: { ...f.properties, etLabel: fmtDayET((f.properties as any).time) } })) } : null);
}
