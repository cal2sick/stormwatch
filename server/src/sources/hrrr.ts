import { getJson } from "../http.js";
import type { ForecastRadar } from "../types.js";

// Forecast radar, 0-3 hours: NOAA HRRR model simulated composite reflectivity, rendered as map tiles by the
// Iowa Environmental Mesonet (free, keyless). Tiles: cache/tile.py/1.0.0/hrrr::REFD-F{minute}-{runYYYYMMDDHHMM}/{z}/{x}/{y}.png
// Each forecast minute has a small JSON with the model run and valid time. HRRR is a model, not observed radar.
export const HRRR_META_URL = (fMinute: number) => `https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_${String(fMinute).padStart(4, "0")}.json`;
export const FORECAST_LEADS = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];
interface Meta { model_init_utc: string; forecast_minute: number; model_forecast_utc: string }

/** Forecast minute (from the model run) for a lead time from now: 15-minute steps up to 5 h, hourly after. */
export function forecastMinuteFor(initIso: string, now: number, leadMin: number): number {
  const m = (now + leadMin * 60_000 - Date.parse(initIso)) / 60_000;
  return m <= 300 ? Math.max(0, Math.round(m / 15) * 15) : Math.round(m / 60) * 60;
}

export async function fetchForecastRadar(now = Date.now()): Promise<{ data: ForecastRadar; sourceTime: string | null }> {
  const base = await getJson<Meta>(HRRR_META_URL(0));
  const init = base.model_init_utc;
  if (!init || !isFinite(Date.parse(init))) throw new Error("HRRR: no model run time");
  const steps: ForecastRadar["steps"] = [];
  for (const lead of FORECAST_LEADS) {
    const fm = forecastMinuteFor(init, now, lead);
    try {
      const m = await getJson<Meta>(HRRR_META_URL(fm));
      if (m.model_init_utc !== init) continue; // a new run is half-uploaded; skip this step
      if (steps.some((s) => s.fMinute === fm)) continue; // hourly steps past 5 h can repeat
      steps.push({ leadMin: lead, fMinute: fm, validTime: new Date(Date.parse(m.model_forecast_utc)).toISOString(), initTime: new Date(Date.parse(init)).toISOString() });
    } catch { /* this minute is not published for the run; leave the step out */ }
  }
  return { data: { source: "NOAA HRRR model (simulated radar) via Iowa Environmental Mesonet", initTime: new Date(Date.parse(init)).toISOString(), steps }, sourceTime: init };
}
