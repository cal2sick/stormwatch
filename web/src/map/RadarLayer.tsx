// Radar loop: one raster source per frame, cycled by opacity. Default IEM NEXRAD n0q (5-min, archived); RainViewer fallback.
// Plus one "radar-at" source for any past slider time beyond the loop (IEM archive, time-matched).
import type { Map as MlMap } from "maplibre-gl";
import type { RadarFrames } from "../types";

const PREFIX = "radar-";
export const RADAR_MAX_FRAMES = 13; // ~2 h at 10-min spacing (all RainViewer past frames), so the slider can go back

export function syncRadarFrames(m: MlMap, radar: RadarFrames | null, enabled: boolean): string[] {
  const frames = enabled && radar ? radar.frames.slice(-RADAR_MAX_FRAMES) : [];
  const want = new Set(frames.map((f) => PREFIX + f.path.replace(/\W/g, "")));
  for (const l of m.getStyle().layers ?? []) {
    if (l.id.startsWith(PREFIX) && !want.has(l.id)) { m.removeLayer(l.id); if (m.getSource(l.id)) m.removeSource(l.id); }
  }
  const before = m.getLayer("cone-fill") ? "cone-fill" : undefined;
  for (const f of frames) {
    const id = PREFIX + f.path.replace(/\W/g, "");
    if (m.getLayer(id)) continue;
    const iem = radar!.kind === "iem";
    m.addSource(id, iem
      ? { type: "raster", tiles: [`${radar!.host}${f.path}/{z}/{x}/{y}.png`], tileSize: 256, maxzoom: 8, attribution: IEM_ATTR }
      : { type: "raster", tiles: [`${radar!.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256, maxzoom: 7, attribution: '<a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>' });
    m.addLayer({ id, type: "raster", source: id, paint: iem ? { "raster-opacity": 0, "raster-fade-duration": 0 } : { "raster-opacity": 0, "raster-fade-duration": 0, "raster-saturation": -0.85, "raster-contrast": 0.15 } }, before);
  }
  return frames.map((f) => PREFIX + f.path.replace(/\W/g, ""));
}

const IEM_ATTR = 'Radar: NOAA NEXRAD via <a href="https://mesonet.agron.iastate.edu/" target="_blank">Iowa Environmental Mesonet</a>';
export const IEM_HOST = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-";

/** Show the archived IEM radar frame for `stamp` (YYYYMMDDHHMM), or hide it when null. */
export function showRadarAt(m: MlMap, stamp: string | null, enabled: boolean) {
  const id = "radar-at";
  if (!m.getSource(id)) {
    m.addSource(id, { type: "raster", tiles: [`${IEM_HOST}000000000000/{z}/{x}/{y}.png`], tileSize: 256, maxzoom: 8, attribution: IEM_ATTR });
    m.addLayer({ id, type: "raster", source: id, layout: { visibility: "none" }, paint: { "raster-opacity": 0.6, "raster-fade-duration": 0 } }, m.getLayer("cone-fill") ? "cone-fill" : undefined);
  }
  if (!stamp || !enabled) { m.setLayoutProperty(id, "visibility", "none"); return; }
  (m.getSource(id) as unknown as { setTiles: (t: string[]) => void }).setTiles([`${IEM_HOST}${stamp}/{z}/{x}/{y}.png`]);
  m.setLayoutProperty(id, "visibility", "visible");
}

export function showRadarFrame(m: MlMap, ids: string[], idx: number) {
  ids.forEach((id, i) => { if (m.getLayer(id)) m.setPaintProperty(id, "raster-opacity", i === idx ? 0.6 : 0); });
}
