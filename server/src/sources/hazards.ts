// Severe-weather hazards drawn on the map: SPC tornado / severe thunderstorm watches (polygons from
// IEM, because SPC's own ActiveWW.kml returns 404 and NWS watch alerts have no polygon), NWS tornado
// warnings and flash flood warnings (storm-based polygons, official text kept verbatim) and NWS
// flash flood watches (county/zone areas, geometry looked up from api.weather.gov/zones and cached).
import { getJson } from "../http.js";
import { pointInGeometry } from "../geo.js";
import type { Hazard, HazardKind } from "../types.js";

export const SPC_WATCH_URL = "https://mesonet.agron.iastate.edu/json/spcwatch.py";
export const IEM_SBW_URL = "https://mesonet.agron.iastate.edu/geojson/sbw.geojson";
export const NWS_HAZARD_EVENTS = ["Tornado Warning", "Flash Flood Warning", "Flash Flood Watch"];
export const nwsHazardsUrl = () =>
  `https://api.weather.gov/alerts/active?event=${NWS_HAZARD_EVENTS.map(encodeURIComponent).join(",")}`;

/** Plain-English one-liners. Wording follows NWS meaning; never says "safe". */
export const PLAIN: Record<HazardKind, string> = {
  tornadoWarning: "Tornado Warning: a tornado is happening or about to happen in this area. Take shelter now.",
  tornadoWatch: "Tornado Watch: conditions can produce tornadoes in this area. Know where you will take shelter.",
  severeWatch: "Severe Thunderstorm Watch: damaging wind or hail is possible in this area.",
  flashFloodWarning: "Flash Flood Warning: flash flooding is happening or about to happen. Move to higher ground. Turn around, don't drown.",
  flashFloodWatch: "Flash Flood Watch: heavy rain may cause flash flooding in this area.",
};

const isoOrNull = (s: unknown) => (typeof s === "string" && !isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);
const round = (g: GeoJSON.Geometry): GeoJSON.Geometry => {
  const r = (c: any): any => (typeof c[0] === "number" ? [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000] : c.map(r));
  return "coordinates" in g ? ({ ...g, coordinates: r(g.coordinates) } as GeoJSON.Geometry) : g;
};

/** IEM spcwatch.py -> hazards. Drops watches already expired at `now`. */
export function parseSpcWatches(raw: { features?: any[] }, now = Date.now()): Hazard[] {
  return (raw.features ?? []).flatMap((f): Hazard[] => {
    const p = f.properties ?? {};
    const expires = isoOrNull(p.expire);
    if (!f.geometry || !expires || Date.parse(expires) <= now) return [];
    const kind: HazardKind = p.type === "TOR" ? "tornadoWatch" : "severeWatch";
    const name = `${kind === "tornadoWatch" ? "Tornado Watch" : "Severe Thunderstorm Watch"} ${p.number}`;
    return [{
      id: `spc-${p.year}-${p.number}`, kind, title: p.is_pds ? `${name} (Particularly Dangerous Situation)` : name,
      plain: PLAIN[kind], onset: isoOrNull(p.issue), expires, issuer: "NOAA Storm Prediction Center",
      source: "SPC watch polygon via Iowa Environmental Mesonet", url: p.spcurl ?? null,
      headline: null, description: null, instruction: null, geometry: round(f.geometry),
    }];
  });
}

const NWS_KIND: Record<string, HazardKind> = {
  "Tornado Warning": "tornadoWarning", "Flash Flood Warning": "flashFloodWarning", "Flash Flood Watch": "flashFloodWatch",
};

/** NWS alerts -> hazards. Official text is kept verbatim. Alerts with no polygon keep geometry=null + zone list. */
export function parseNwsHazards(raw: { features?: any[] }, now = Date.now()): (Hazard & { zones: string[] })[] {
  return (raw.features ?? []).flatMap((f): (Hazard & { zones: string[] })[] => {
    const p = f.properties ?? {};
    const kind = NWS_KIND[p.event];
    const expires = isoOrNull(p.ends) ?? isoOrNull(p.expires);
    if (!kind || !expires || Date.parse(expires) <= now || p.messageType === "Cancel") return [];
    const text = `${p.headline ?? ""} ${p.description ?? ""}`;
    const emergency = kind === "flashFloodWarning" && /FLASH FLOOD EMERGENCY/i.test(text);
    const pds = kind === "tornadoWarning" && /TORNADO EMERGENCY/i.test(text);
    return [{
      id: String(p.id ?? f.id), kind,
      title: pds ? "Tornado Emergency" : emergency ? "Flash Flood Emergency" : p.event,
      plain: PLAIN[kind], onset: isoOrNull(p.onset) ?? isoOrNull(p.effective), expires,
      issuer: p.senderName ?? "National Weather Service", source: "NWS alerts (api.weather.gov)",
      url: typeof f.id === "string" ? f.id : null, headline: p.headline ?? null,
      description: p.description ?? null, instruction: p.instruction ?? null, areaDesc: p.areaDesc ?? null,
      geometry: f.geometry ? round(f.geometry) : null, zones: Array.isArray(p.affectedZones) ? p.affectedZones : [],
    }];
  });
}

/** IEM storm-based warnings fallback (used only if the NWS alerts request fails). No verbatim text. */
export function parseIemSbw(raw: { features?: any[] }, now = Date.now()): Hazard[] {
  return (raw.features ?? []).flatMap((f): Hazard[] => {
    const p = f.properties ?? {};
    const kind: HazardKind | null = p.significance !== "W" ? null : p.phenomena === "TO" ? "tornadoWarning" : p.phenomena === "FF" ? "flashFloodWarning" : null;
    const expires = isoOrNull(p.polygon_end) ?? isoOrNull(p.expire);
    if (!kind || !f.geometry || !expires || Date.parse(expires) <= now) return [];
    return [{
      id: `iem-${p.wfo}-${p.phenomena}-${p.eventid}-${p.year}`, kind, title: kind === "tornadoWarning" ? "Tornado Warning" : "Flash Flood Warning",
      plain: PLAIN[kind], onset: isoOrNull(p.polygon_begin) ?? isoOrNull(p.issue), expires, issuer: `NWS ${p.wfo}`,
      source: "NWS warning polygon via Iowa Environmental Mesonet (backup feed)", url: p.href ?? null,
      headline: null, description: null, instruction: null, geometry: round(f.geometry),
    }];
  });
}

/** Hazards in effect at time t (onset <= t < expires). Missing onset = already in effect. */
export const activeAt = <T extends Pick<Hazard, "onset" | "expires">>(hs: T[], t: number) =>
  hs.filter((h) => (!h.onset || Date.parse(h.onset) <= t) && Date.parse(h.expires) > t);

/** Hazards whose polygon contains the point. */
export const hazardsAtPoint = <T extends Pick<Hazard, "geometry">>(hs: T[], lat: number, lon: number) =>
  hs.filter((h) => h.geometry && pointInGeometry(lon, lat, h.geometry));

// Zone geometry cache (zones don't change during a storm).
const zoneGeo = new Map<string, GeoJSON.Geometry | null>();
const MAX_ZONE_FETCHES = 60;

async function zonesGeometry(urls: string[]): Promise<GeoJSON.Geometry | null> {
  const polys: GeoJSON.Position[][][] = [];
  let fetched = 0;
  for (const u of urls) {
    if (!zoneGeo.has(u)) {
      if (fetched++ >= MAX_ZONE_FETCHES) continue;
      try { const z = await getJson<{ geometry: GeoJSON.Geometry | null }>(u, "application/geo+json"); zoneGeo.set(u, z.geometry ? round(z.geometry) : null); }
      catch { continue; }
    }
    const g = zoneGeo.get(u);
    if (g?.type === "Polygon") polys.push(g.coordinates);
    else if (g?.type === "MultiPolygon") polys.push(...g.coordinates);
  }
  return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
}

export interface HazardFetch { hazards: Hazard[]; sourceTime: string | null; notes: string[] }

export async function fetchHazards(now = Date.now()): Promise<HazardFetch> {
  const notes: string[] = [];
  const out: Hazard[] = [];
  let sourceTime: string | null = null;
  let spcOk = false, nwsOk = false;
  try { out.push(...parseSpcWatches(await getJson<{ features: any[] }>(SPC_WATCH_URL), now)); spcOk = true; }
  catch (e) { notes.push(`SPC watches unavailable: ${(e as Error).message}`); }
  try {
    const raw = await getJson<{ features: any[]; updated?: string }>(nwsHazardsUrl(), "application/geo+json");
    sourceTime = raw.updated ? new Date(raw.updated).toISOString() : null;
    for (const h of parseNwsHazards(raw, now)) {
      const { zones, ...rest } = h;
      if (!rest.geometry && zones.length) rest.geometry = await zonesGeometry(zones);
      if (rest.geometry) out.push(rest); else notes.push(`${rest.title} (${rest.areaDesc ?? "area"}) has no map shape`);
    }
    nwsOk = true;
  } catch (e) {
    notes.push(`NWS warnings unavailable (${(e as Error).message}); using backup warning polygons without full text`);
    try { out.push(...parseIemSbw(await getJson<{ features: any[] }>(IEM_SBW_URL), now)); } catch { /* both down */ }
  }
  if (!spcOk && !nwsOk) throw new Error(notes.join("; "));
  return { hazards: out, sourceTime: sourceTime ?? new Date(now).toISOString(), notes };
}
