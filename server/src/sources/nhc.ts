import { getJson } from "../http.js";
import { bearingDeg, cardinal, categoryFromKt, distanceMi } from "../geo.js";
import type { Home } from "../config.js";
import type { Storm } from "../types.js";

export const NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";

type Adv = { advNum?: string; issuance?: string; url?: string; zipFile?: string; kmzFile?: string };
export interface RawStorm {
  id: string; name: string; classification: string; intensity?: string; pressure?: string;
  latitudeNumeric: number; longitudeNumeric: number; movementDir?: number; movementSpeed?: number;
  lastUpdate?: string; publicAdvisory?: Adv; trackCone?: Adv; forecastTrack?: Adv; forecastGraphics?: Adv;
  windWatchesWarnings?: Adv; bestTrackGIS?: Adv;
  earliestArrivalTimeTSWindsGIS?: Adv; mostLikelyTimeTSWindsGIS?: Adv;
}

const num = (v: unknown) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));

/** Fetch every active storm from NHC. Nothing about any storm is hard-coded. */
export async function fetchNhc(home: Home): Promise<{ storms: Storm[]; raw: RawStorm[]; sourceTime: string | null }> {
  const raw = await getJson<{ activeStorms: RawStorm[] }>(NHC_URL);
  const list = raw.activeStorms ?? [];
  const storms = list.map((s): Storm => {
    const b = bearingDeg(home.lat, home.lon, s.latitudeNumeric, s.longitudeNumeric);
    const kt = num(s.intensity); // NHC intensity is knots
    return {
      id: s.id,
      name: s.name,
      classification: s.classification,
      category: categoryFromKt(kt),
      intensityKt: kt,
      pressureMb: num(s.pressure),
      lat: s.latitudeNumeric,
      lon: s.longitudeNumeric,
      movementDirDeg: num(s.movementDir),
      movementSpeedMph: num(s.movementSpeed), // mph (matches the public advisory "PRESENT MOVEMENT")
      lastUpdate: s.lastUpdate ?? null,
      advisoryNumber: s.publicAdvisory?.advNum ?? null,
      advisoryIssuance: s.publicAdvisory?.issuance ?? null,
      publicAdvisoryUrl: s.publicAdvisory?.url ?? null,
      graphicsUrl: s.forecastGraphics?.url ?? null,
      coneZipUrl: s.trackCone?.zipFile ?? null,
      coneKmzUrl: s.trackCone?.kmzFile ?? null,
      trackKmzUrl: s.forecastTrack?.kmzFile ?? null,
      distanceMi: Math.round(distanceMi(home.lat, home.lon, s.latitudeNumeric, s.longitudeNumeric) * 10) / 10,
      bearingDeg: Math.round(b),
      bearingCardinal: cardinal(b),
      inCone: null, tsArrival: null, trackCpa: null, motionCpa: null, advisoryText: null,
    };
  }).sort((a, b) => a.distanceMi - b.distanceMi);
  const sourceTime = storms.map((s) => s.lastUpdate).filter(Boolean).sort().pop() ?? null;
  return { storms, raw: list, sourceTime };
}
