// Live cameras near the storm / your location. Adapter per provider; all keyless by default.
// - USGS HIVIS (NIMS): public river/coast cameras, https://api.waterdata.usgs.gov/docs/nims/overview/  (on)
// - Windy Webcams: optional, only with YOUR OWN key in .env (WINDY_API_KEY). Never commit a key.     (off)
// - FAA WeatherCams: stub. No documented keyless public API yet; link only.                            (off)
import { getJson } from "../http.js";
import { distanceMi } from "../geo.js";
import type { Camera } from "../types.js";

export const HIVIS_URL = "https://api.waterdata.usgs.gov/nims/cameras";
export const CAMERA_LINKS = [
  { name: "FAA WeatherCams (aviation cameras)", url: "https://weathercams.faa.gov/" },
  { name: "Florida 511 traffic cameras", url: "https://fl511.com/" },
  { name: "Georgia 511 traffic cameras", url: "https://511ga.org/" },
];

interface HivisCam { camId: string; camName: string; lat: string; lng: string; hideCam?: boolean; newestImageDT?: string; smallDir?: string; thumbDir?: string; nwisId?: string }

/** Pure: USGS HIVIS list -> cameras within `radiusMi` of any center, with an image newer than `maxAgeH`. */
export function hivisNear(list: HivisCam[], centers: { lat: number; lon: number }[], radiusMi = 250, maxAgeH = 6, now = Date.now(), max = 40): Camera[] {
  const out: (Camera & { d: number })[] = [];
  for (const c of list) {
    const lat = Number(c.lat), lon = Number(c.lng);
    if (c.hideCam || !isFinite(lat) || !isFinite(lon) || !c.newestImageDT || !c.smallDir) continue;
    if (now - Date.parse(c.newestImageDT) > maxAgeH * 3_600_000) continue;
    const d = Math.min(...centers.map((x) => distanceMi(x.lat, x.lon, lat, lon)));
    if (d > radiusMi) continue;
    out.push({ id: `usgs:${c.camId}`, name: c.camName, lat, lon, source: "USGS HIVIS", time: c.newestImageDT,
      imageUrl: `${c.smallDir}${c.camId}_newest.jpg`, thumbUrl: c.thumbDir ? `${c.thumbDir}${c.camId}_newest.jpg` : null,
      pageUrl: `https://apps.usgs.gov/hivis/camera/${encodeURIComponent(c.camId)}`, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max).map(({ d: _d, ...c }) => c);
}

/** Optional: Windy Webcams API v3, only if the user put their own key in .env. */
async function windyNear(key: string, center: { lat: number; lon: number }): Promise<Camera[]> {
  const url = `https://api.windy.com/webcams/api/v3/webcams?nearby=${center.lat.toFixed(2)},${center.lon.toFixed(2)},250&limit=30&include=images,location,urls`;
  const r = await fetch(url, { headers: { "x-windy-api-key": key }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Windy HTTP ${r.status}`);
  const d = (await r.json()) as { webcams?: any[] };
  return (d.webcams ?? []).map((w) => ({ id: `windy:${w.webcamId}`, name: w.title, lat: w.location?.latitude, lon: w.location?.longitude, source: "Windy Webcams",
    time: w.lastUpdatedOn ?? null, imageUrl: w.images?.current?.preview ?? null, thumbUrl: w.images?.current?.thumbnail ?? null, pageUrl: w.urls?.detail ?? "https://www.windy.com/webcams" }))
    .filter((c) => isFinite(c.lat) && isFinite(c.lon) && c.imageUrl);
}

export async function fetchCameras(centers: { lat: number; lon: number }[], windyKey: string): Promise<{ cameras: Camera[]; sourceTime: string | null }> {
  if (!centers.length) return { cameras: [], sourceTime: null };
  const list = await getJson<HivisCam[]>(HIVIS_URL);
  let cams = hivisNear(Array.isArray(list) ? list : [], centers);
  if (windyKey) cams = [...cams, ...(await windyNear(windyKey, centers[0]).catch(() => []))];
  return { cameras: cams, sourceTime: cams.map((c) => c.time ?? "").sort().pop() || null };
}
