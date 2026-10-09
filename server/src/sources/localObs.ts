// Latest observation from the nearest NWS station to your location (an airport ASOS/AWOS), via api.weather.gov.
// The station is found from your own HOME_LAT/HOME_LON (NWS points -> observationStations); nothing is hard-coded.
import { getJson } from "../http.js";
import type { Home } from "../config.js";
import type { LocalObs } from "../types.js";

export const pointsUrl = (h: Home) => `https://api.weather.gov/points/${h.lat.toFixed(4)},${h.lon.toFixed(4)}`;
const G = "application/geo+json";
const v = (x: { value?: number | null } | undefined) => (x?.value == null || !isFinite(x.value) ? null : x.value);

/** Pure: NWS observation JSON -> plain units (mph, °F, inches of mercury -> mb kept). */
export function parseObs(stationId: string, stationName: string, p: Record<string, any>): LocalObs {
  const kmh = (x: number | null) => (x == null ? null : Math.round(x * 0.621371));
  const c = v(p.temperature);
  return {
    stationId, stationName, time: p.timestamp ?? null, text: p.textDescription ?? null,
    tempF: c == null ? null : Math.round(c * 9 / 5 + 32), windMph: kmh(v(p.windSpeed)), gustMph: kmh(v(p.windGust)),
    windDirDeg: v(p.windDirection), pressureMb: v(p.seaLevelPressure) == null ? null : Math.round(v(p.seaLevelPressure)! / 10) / 10,
    rainLastHourIn: v(p.precipitationLastHour) == null ? null : Math.round((v(p.precipitationLastHour)! / 25.4) * 100) / 100,
    url: `https://www.weather.gov/wrh/timeseries?site=${stationId}`,
  };
}

let station: { key: string; id: string; name: string } | null = null;
export async function fetchLocalObs(h: Home): Promise<{ obs: LocalObs; sourceTime: string | null }> {
  const key = `${h.lat.toFixed(3)},${h.lon.toFixed(3)}`;
  if (!station || station.key !== key) {
    const pts = await getJson<{ properties: { observationStations: string } }>(pointsUrl(h), G);
    const st = await getJson<{ features: { properties: { stationIdentifier: string; name: string } }[] }>(pts.properties.observationStations, G);
    const f = st.features[0]?.properties;
    if (!f) throw new Error("no NWS observation station near this location");
    station = { key, id: f.stationIdentifier, name: f.name };
  }
  const o = await getJson<{ properties: Record<string, any> }>(`https://api.weather.gov/stations/${station.id}/observations/latest`, G);
  const obs = parseObs(station.id, station.name, o.properties);
  return { obs, sourceTime: obs.time };
}
