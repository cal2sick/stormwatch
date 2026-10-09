// RainViewer radar loop: one raster source per frame, cycled by opacity. Tiles render to z7 (free tier).
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
    m.addSource(id, { type: "raster", tiles: [`${radar!.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256, maxzoom: 7,
      attribution: '<a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>' });
    m.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-saturation": -0.85, "raster-contrast": 0.15 } }, before);
  }
  return frames.map((f) => PREFIX + f.path.replace(/\W/g, ""));
}

export function showRadarFrame(m: MlMap, ids: string[], idx: number) {
  ids.forEach((id, i) => { if (m.getLayer(id)) m.setPaintProperty(id, "raster-opacity", i === idx ? 0.55 : 0); });
}
