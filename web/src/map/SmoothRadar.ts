// v0.6.1 "Smooth live radar (estimate)". NEXRAD only produces a new national composite every ~5 minutes, so between scans
// we slide the latest real scan along the motion measured from the last two scans (server: /api/radar-motion,
// cross-correlation of two downsampled scans, NHC storm motion as fallback). The image moves continuously, then
// snaps to the real scan when it arrives. It is an ESTIMATE and is labeled that way on the map.
import type { ImageSource, Map as MlMap } from "maplibre-gl";
import type { RadarMotion } from "../types";

const R = 6378137;
const toMerc = (lon: number, lat: number): [number, number] => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const fromMerc = (x: number, y: number): [number, number] => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
export const SMOOTH_HALF_M = 900_000; // image covers about 1,100 miles square around your home
export const MAX_EXTRAPOLATE_MIN = 15; // never slide further than this; past it the scan is stale and we say so
const SIZE = 1600;
const OPACITY = 0.62;
const ID = "radar-smooth";

export const smoothImageUrl = (lat: number, lon: number, scanIso: string) => {
  const [x, y] = toMerc(lon, lat), b = [x - SMOOTH_HALF_M, y - SMOOTH_HALF_M, x + SMOOTH_HALF_M, y + SMOOTH_HALF_M].map(Math.round);
  return `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=nexrad-n0q-wmst&SRS=EPSG:3857&BBOX=${b.join(",")}&WIDTH=${SIZE}&HEIGHT=${SIZE}&FORMAT=image/png&TRANSPARENT=true&TIME=${scanIso.slice(0, 16)}:00Z`;
};
/** Image corners (TL, TR, BR, BL) shifted by `dtSec` of motion. */
export function shiftedCorners(lat: number, lon: number, motion: RadarMotion | null, dtSec: number): [[number, number], [number, number], [number, number], [number, number]] {
  const [x, y] = toMerc(lon, lat), dx = (motion?.vx ?? 0) * dtSec, dy = (motion?.vy ?? 0) * dtSec, h = SMOOTH_HALF_M;
  const c = (px: number, py: number) => fromMerc(x + px + dx, y + py + dy);
  return [c(-h, h), c(h, h), c(h, -h), c(-h, -h)];
}
/** Minutes of extrapolation shown for the current time (0..MAX). */
export const estimateMinutes = (scanIso: string, now: number) => Math.max(0, Math.min(MAX_EXTRAPOLATE_MIN, (now - Date.parse(scanIso)) / 60_000));

export class SmoothRadar {
  private url: string | null = null;
  private center: { lat: number; lon: number } | null = null;
  private scan: string | null = null;
  private motion: RadarMotion | null = null;
  private raf = 0;
  private lastPaint = 0;
  loaded = false;
  constructor(private m: MlMap, private onLoaded: (ok: boolean) => void) {
    m.on("sourcedata", (e: any) => {
      if (e.sourceId !== ID || !this.url) return;
      try { if (m.isSourceLoaded(ID) && !this.loaded) { this.loaded = true; m.setPaintProperty(ID, "raster-opacity", OPACITY); this.onLoaded(true); } } catch { /* removed */ }
    });
    m.on("error", (e: any) => { if (e?.sourceId === ID) this.onLoaded(false); });
  }
  private before() { return this.m.getLayer("cone-fill") ? "cone-fill" : undefined; }
  /** Show the scan `scanIso` around (lat, lon), drifting with `motion`. Keeps the previous image until the new one loads. */
  show(lat: number, lon: number, scanIso: string, motion: RadarMotion | null) {
    this.motion = motion;
    const url = smoothImageUrl(lat, lon, scanIso);
    if (url !== this.url) {
      const first = !this.m.getSource(ID);
      this.url = url;
      const coords = shiftedCorners(lat, lon, null, 0);
      if (first) {
        this.m.addSource(ID, { type: "image", url, coordinates: coords });
        this.m.addLayer({ id: ID, type: "raster", source: ID, paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-resampling": "linear" } as any }, this.before());
        this.loaded = false;
      } else {
        // updateImage swaps only once the new image has loaded, so the old scan stays on screen meanwhile.
        (this.m.getSource(ID) as ImageSource).updateImage({ url, coordinates: shiftedCorners(lat, lon, this.motion, (Date.now() - Date.parse(scanIso)) / 1000) });
      }
      this.center = { lat, lon }; this.scan = scanIso;
    }
    if (!this.raf) this.tick();
  }
  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const now = Date.now();
    if (now - this.lastPaint < 200 || !this.center || !this.scan) return; // ~5 fps is smooth enough for a slow drift
    this.lastPaint = now;
    const src = this.m.getSource(ID) as ImageSource | undefined;
    try { src?.setCoordinates(shiftedCorners(this.center.lat, this.center.lon, this.motion, estimateMinutes(this.scan, now) * 60)); } catch { /* image not ready */ }
  };
  hide() {
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.m.getLayer(ID)) this.m.removeLayer(ID);
    if (this.m.getSource(ID)) this.m.removeSource(ID);
    this.url = null; this.loaded = false; this.center = null; this.scan = null;
  }
}
