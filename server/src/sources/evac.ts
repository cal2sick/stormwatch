// Florida Division of Emergency Management "Know Your Zone" evacuation zones (statewide ArcGIS feature service, keyless).
// PRIVACY: the selected place goes only to FDEM's public query endpoint, never cached by URL or written to disk.
// Zones are planning areas. Whether a zone is under an evacuation ORDER is decided by the county; we link to them.
import { getJsonNoCache } from "./place.js";

export const FDEM_EVAC = "https://services1.arcgis.com/CY1LXxl9zlJeBuRZ/ArcGIS/rest/services/Evacuation_Zones/FeatureServer/0";
const FL_BBOX = [-87.7, 24.3, -79.8, 31.1];
export const inFlorida = (lat: number, lon: number) => lon >= FL_BBOX[0] && lon <= FL_BBOX[2] && lat >= FL_BBOX[1] && lat <= FL_BBOX[3];

export interface EvacResult {
  covered: boolean;          // inside the FDEM statewide layer's area (Florida)
  zone: string | null;       // "A".."F" or null = not in a mapped evacuation zone
  county: string | null;
  countyZones: GeoJSON.FeatureCollection | null; // the county's zones (simplified) for the map
  source: string; checked: string; links: { name: string; url: string }[];
}

/** Pure: pick the lowest (most at-risk) zone letter from point-query features. */
export function pickZone(features: { attributes: Record<string, unknown> }[]): { zone: string | null; county: string | null } {
  const z = features.map((f) => ({ zone: String(f.attributes.EZone ?? "").trim().toUpperCase(), county: String(f.attributes.County_Nam ?? "").trim() }))
    .filter((x) => x.zone).sort((a, b) => a.zone.localeCompare(b.zone));
  return z[0] ? { zone: z[0].zone, county: z[0].county ? z[0].county[0] + z[0].county.slice(1).toLowerCase() : null } : { zone: null, county: null };
}

export async function evacZone(p: { lat: number; lon: number }): Promise<EvacResult> {
  const base = { source: "Florida Division of Emergency Management, Know Your Zone", checked: new Date().toISOString(),
    links: [{ name: "Florida Know Your Zone", url: "https://www.floridadisaster.org/knowyourzone/" }, { name: "Florida open shelters", url: "https://www.floridadisaster.org/planprepare/disaster-preparedness-maps/shelters/" }] };
  if (!inFlorida(p.lat, p.lon)) return { covered: false, zone: null, county: null, countyZones: null, ...base };
  const q = `${FDEM_EVAC}/query?geometry=${p.lon.toFixed(5)},${p.lat.toFixed(5)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=EZone,County_Nam&returnGeometry=false&f=json`;
  const r = await getJsonNoCache<{ features?: { attributes: Record<string, unknown> }[] }>(q);
  const { zone, county } = pickZone(r.features ?? []);
  let countyZones: GeoJSON.FeatureCollection | null = null;
  if (county) {
    const where = encodeURIComponent(`County_Nam='${county.toUpperCase().replace(/'/g, "''")}'`);
    countyZones = await getJsonNoCache<GeoJSON.FeatureCollection>(`${FDEM_EVAC}/query?where=${where}&outFields=EZone&returnGeometry=true&geometryPrecision=4&maxAllowableOffset=0.002&f=geojson`).catch(() => null);
  }
  return { covered: true, zone, county, countyZones, ...base };
}
