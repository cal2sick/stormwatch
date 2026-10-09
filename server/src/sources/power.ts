// Power outages. Everything here is an OPTIONAL plugin, off by default:
//  - OUTAGE_ARCGIS_URL: any utility's public ArcGIS outage-points query (point-level outages, no key).
//  - ODIN_FIPS: ORNL ODIN public API, county-level reports for one county FIPS code.
// Always-on: link-outs only. Never scrape behind logins, CAPTCHAs or embedded API keys.
// See docs/DATA-SOURCES.md. Be polite: one request per poll, never in parallel.
import { getJson } from "../http.js";
import { distanceMi } from "../geo.js";
import { ODIN_FIPS, OUTAGE_ARCGIS_NAME, OUTAGE_ARCGIS_URL, OUTAGE_MAP_URL, type Home } from "../config.js";
import type { Outage, Power } from "../types.js";

export const ODIN_URL = "https://odin.ornl.gov/odi?format=JSON";

export const POWER_LINKS = [
  ...(OUTAGE_MAP_URL ? [{ name: `${OUTAGE_ARCGIS_NAME} map`, url: OUTAGE_MAP_URL }] : []),
  { name: "PowerOutage.us (United States)", url: "https://poweroutage.us/" },
];

export async function fetchArcgisOutages(home: Home, url = OUTAGE_ARCGIS_URL): Promise<{ local: NonNullable<Power["local"]>; sourceTime: string | null }> {
  const r = await getJson<{ features?: { attributes: Record<string, any>; geometry?: { x: number; y: number } }[]; error?: { message: string } }>(url);
  if (r.error) throw new Error(`ArcGIS outages: ${r.error.message}`);
  const now = Date.now();
  const outages: Outage[] = (r.features ?? []).filter((f) => f.geometry).map((f) => {
    const a = f.attributes, lat = f.geometry!.y, lon = f.geometry!.x;
    return {
      lat, lon, customers: Number(a.customers ?? a.CUSTOMERS ?? 0), status: a.status ?? null, cause: a.cause ?? null, type: a.outagetype ?? null,
      off: a.off ? new Date(a.off).toISOString() : null, etr: a.etr ? new Date(a.etr).toISOString() : null,
      etrPassed: a.etr ? a.etr < now : false,
      distanceMi: Math.round(distanceMi(home.lat, home.lon, lat, lon) * 10) / 10,
    };
  }).sort((a, b) => a.distanceMi - b.distanceMi);
  return {
    local: { name: OUTAGE_ARCGIS_NAME, outages, count: outages.length, totalCustomers: outages.reduce((s, o) => s + o.customers, 0), nearestMi: outages[0]?.distanceMi ?? null },
    sourceTime: new Date().toISOString(), // these layers rarely carry a feed timestamp; "as of" our fetch
  };
}

export async function fetchOdin(fips = ODIN_FIPS): Promise<{ odin: NonNullable<Power["odin"]>; sourceTime: string | null }> {
  const r = await getJson<{ outage?: any[] }>(ODIN_URL);
  const rows = (r.outage ?? []).filter((o) => String(o.communityDescriptor ?? "").startsWith(fips)).map((o) => ({
    utility: o.names?.find((n: any) => n.nameType === "UtilityName")?.name ?? "Unknown utility",
    customers: Number(o.metersAffected ?? 0),
    start: o.outageArea?.earliestReported ?? o.actualPeriod?.start ?? null,
  }));
  return { odin: { fips, rows, totalCustomers: rows.reduce((s, x) => s + x.customers, 0) }, sourceTime: new Date().toISOString() };
}
