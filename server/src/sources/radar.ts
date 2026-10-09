import { getJson } from "../http.js";
import type { RadarFrames } from "../types.js";

export const RAINVIEWER_URL = "https://api.rainviewer.com/public/weather-maps.json";

/** RainViewer frame list (past ~2 h, 10-min frames). The browser loads the tiles itself. */
export async function fetchRadar(): Promise<{ radar: RadarFrames; sourceTime: string | null }> {
  const r = await getJson<{ host: string; generated: number; radar: { past: { time: number; path: string }[] } }>(RAINVIEWER_URL);
  const frames = (r.radar?.past ?? []).map((f) => ({ time: new Date(f.time * 1000).toISOString(), path: f.path }));
  const last = frames.at(-1)?.time ?? null;
  return { radar: { host: r.host, frames, generated: r.generated ? new Date(r.generated * 1000).toISOString() : null }, sourceTime: last };
}
