// Radar on the map (v0.5): a small pool of raster sources, one per frame URL.
// Fixes the v0.4 blank-radar bug: a new frame is added hidden, its tiles load, and only then does it crossfade in.
// The previous frame stays on screen until then, so scrubbing never shows an empty map.
import type { Map as MlMap } from "maplibre-gl";

export const IEM_ATTR = 'Radar: NOAA NEXRAD and NOAA HRRR model via <a href="https://mesonet.agron.iastate.edu/" target="_blank">Iowa Environmental Mesonet</a>';
const RV_ATTR = '<a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>';
const OPACITY = 0.62;
const FADE_MS = 250;
const MAX_SOURCES = 24;
const LOAD_TIMEOUT_MS = 8000;

export type RadarLoadState = "idle" | "loading" | "ready" | "slow";

export class RadarPool {
  private ids = new Map<string, string>(); // url -> layer/source id
  private used = new Map<string, number>(); // url -> last use
  private n = 0;
  private want: string | null = null;
  private shown: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private m: MlMap, private onState: (s: RadarLoadState, shownUrl: string | null) => void) {
    m.on("sourcedata", (e: any) => {
      if (!e.sourceId) return;
      if (e.tile) this.tiled.add(e.sourceId);
      if (!this.want) return;
      if (this.ids.get(this.want) === e.sourceId && this.loaded(this.want)) this.activate(this.want);
    });
  }
  private before() { return this.m.getLayer("cone-fill") ? "cone-fill" : undefined; }
  private ensure(url: string): string {
    let id = this.ids.get(url);
    if (id && this.m.getSource(id)) { this.used.set(url, Date.now()); return id; }
    id = `radar-p${this.n++}`;
    const rv = url.includes("rainviewer");
    this.m.addSource(id, { type: "raster", tiles: [url], tileSize: 256, maxzoom: rv ? 7 : 8, attribution: rv ? RV_ATTR : IEM_ATTR });
    this.m.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: FADE_MS, delay: 0 }, "raster-fade-duration": 0 } as any }, this.before());
    this.ids.set(url, id); this.used.set(url, Date.now());
    this.evict();
    return id;
  }
  private evict() {
    if (this.ids.size <= MAX_SOURCES) return;
    const old = [...this.used.entries()].filter(([u]) => u !== this.want && u !== this.shown && !this.keep.has(u)).sort((a, b) => a[1] - b[1]);
    for (const [u] of old.slice(0, this.ids.size - MAX_SOURCES)) {
      const id = this.ids.get(u)!; if (this.m.getLayer(id)) this.m.removeLayer(id); if (this.m.getSource(id)) this.m.removeSource(id);
      this.ids.delete(u); this.used.delete(u); this.tiled.delete(id);
    }
  }
  private keep = new Set<string>();
  private tiled = new Set<string>(); // sources that have received at least one tile (isSourceLoaded is true before any tile is requested)
  loaded(url: string): boolean { const id = this.ids.get(url); try { return !!id && this.tiled.has(id) && this.m.isSourceLoaded(id); } catch { return false; } }
  /** Start loading frames in the background (hidden), e.g. the 2-hour loop, so playback is smooth. */
  preload(urls: string[]) { this.keep = new Set(urls); for (const u of urls) this.ensure(u); }
  /** Show `url`; keeps the current frame until the new one has loaded. null hides radar. */
  show(url: string | null) {
    this.want = url;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!url) { this.fadeTo(null); this.onState("idle", null); return; }
    this.ensure(url);
    if (this.loaded(url)) { this.activate(url); return; }
    this.onState("loading", this.shown);
    this.timer = setTimeout(() => { if (this.want === url) { this.activate(url); this.onState("slow", url); } }, LOAD_TIMEOUT_MS);
  }
  private activate(url: string) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.fadeTo(url);
    this.onState("ready", url);
  }
  private hidden = false;
  /** v0.6.1: hide the tile radar while the smooth-live overlay is on screen (loading continues underneath). */
  setHidden(h: boolean) { if (h === this.hidden) return; this.hidden = h; this.fadeTo(this.shown); }
  private fadeTo(url: string | null) {
    this.shown = url;
    for (const [u, id] of this.ids) if (this.m.getLayer(id)) this.m.setPaintProperty(id, "raster-opacity", u === url && !this.hidden ? OPACITY : 0);
  }
  clear() { this.keep.clear(); this.show(null); }
}
