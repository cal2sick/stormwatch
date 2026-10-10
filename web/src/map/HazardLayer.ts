// Severe-weather hazard polygons: tornado / severe watches (SPC), tornado warnings and flash flood
// warnings / watches (NWS). Filled faintly, outlined boldly, labelled with title + expiry in ET.
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { HazardFC } from "../hazards";

export const HAZARD_LAYER_IDS = ["hz-fill", "hz-line", "hz-label"];

/** v0.7.1: ONE label point per shape (inside it, near its middle) instead of MapLibre's per-tile polygon labels, which repeated and piled up. */
export function labelPoint(g: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!g) return null;
  const polys: number[][][][] = g.type === "Polygon" ? [g.coordinates as number[][][]] : g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : [];
  if (!polys.length) return null;
  const area = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
  const poly = polys.reduce((m, p) => (area(p[0]) > area(m[0]) ? p : m));
  const inside = (x: number, y: number) => { let c = false; for (const r of poly) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const ring = poly[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (inside(cx, cy)) return [cx, cy];
  let best: [number, number] | null = null, bd = Infinity;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const x = x0 + ((x1 - x0) * i) / 12, y = y0 + ((y1 - y0) * j) / 12;
    if (inside(x, y)) { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
  }
  return best ?? [ring[0][0], ring[0][1]];
}
const RANK: Record<string, number> = { tornadoWarning: 0, flashFloodWarning: 1, tornadoWatch: 2, flashFloodWatch: 3, severeWatch: 4 };
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function addHazardLayers(m: MlMap) {
  m.addSource("hazards", { type: "geojson", data: EMPTY });
  m.addSource("hazard-labels", { type: "geojson", data: EMPTY });
  const warn = ["in", ["get", "kind"], ["literal", ["tornadoWarning", "flashFloodWarning"]]];
  m.addLayer({ id: "hz-fill", type: "fill", source: "hazards", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", warn, 0.28, 0.1] } as any });
  m.addLayer({ id: "hz-line", type: "line", source: "hazards", paint: { "line-color": ["get", "color"], "line-width": ["case", warn, 3, 2] } as any });
  // Most urgent first wins a collision (symbol-sort-key), with padding so labels never touch.
  m.addLayer({ id: "hz-label", type: "symbol", source: "hazard-labels", layout: {
    "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 13, "text-max-width": 12, "symbol-sort-key": ["get", "rank"],
    "text-variable-anchor": ["center", "top", "bottom", "left", "right"], "text-radial-offset": 0.6, "text-padding": 6, "text-allow-overlap": false, "text-optional": true },
    paint: { "text-color": ["get", "color"], "text-halo-color": "#04070b", "text-halo-width": 2.2 } as any });
}

export function updateHazardLayers(m: MlMap, data: HazardFC) {
  (m.getSource("hazards") as GeoJSONSource | undefined)?.setData(data as GeoJSON.FeatureCollection);
  const pts = data.features.map((f) => { const c = labelPoint(f.geometry); return c ? { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: c },
    properties: { label: f.properties.label, color: f.properties.color, rank: RANK[f.properties.kind] ?? 9 } } : null; }).filter(Boolean);
  (m.getSource("hazard-labels") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: pts as GeoJSON.Feature[] });
}
