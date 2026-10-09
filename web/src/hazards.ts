// Pure helpers for severe-weather hazards (shared by the map, the banners and tests).
import type { Hazard, HazardKind, HazardSummary } from "./types";

export const HAZARD_HEX: Record<HazardKind, string> = {
  tornadoWarning: "#ff2a2a", tornadoWatch: "#ffd23f", severeWatch: "#5fb3ff", flashFloodWarning: "#2ee66b", flashFloodWatch: "#2e9e6b",
};
export const HAZARD_NAME: Record<HazardKind, string> = {
  tornadoWarning: "Tornado warning", tornadoWatch: "Tornado watch", severeWatch: "Severe thunderstorm watch",
  flashFloodWarning: "Flash flood warning", flashFloodWatch: "Flash flood watch",
};
export const TORNADO_KINDS: HazardKind[] = ["tornadoWarning", "tornadoWatch", "severeWatch"];
export const FLOOD_KINDS: HazardKind[] = ["flashFloodWarning", "flashFloodWatch"];

/** Exact cone wording (spec R26 / safety rule 3). */
export const CONE_TEXT = "The cone shows where the center may go. Dangerous wind, rain, surge and tornadoes often happen outside it.";

/** In effect at time t: started (or no start given) and not yet expired. */
export const activeAt = <T extends Pick<HazardSummary, "onset" | "expires">>(hs: T[], t: number) =>
  hs.filter((h) => (!h.onset || Date.parse(h.onset) <= t) && Date.parse(h.expires) > t);

const ORDER: HazardKind[] = ["tornadoWarning", "flashFloodWarning", "tornadoWatch", "flashFloodWatch", "severeWatch"];
export const byUrgency = <T extends Pick<HazardSummary, "kind" | "expires">>(hs: T[]) =>
  [...hs].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || Date.parse(a.expires) - Date.parse(b.expires));

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" AM", "am").replace(" PM", "pm");
/** "Tornado Watch 677 · until Fri 9pm ET" */
export const hazardLabel = (h: Pick<HazardSummary, "title" | "expires">) => `${h.title} · until ${fmt(h.expires)} ET`;
export const untilET = (iso: string) => `${fmt(iso)} ET`;

/**
 * What the home banner should say right now. Official alerts at the home point (NWS point query) and
 * polygons over the home point both count. Only hazards in effect now; expired ones never show.
 */
export function homeBanner(hazards: HazardSummary[], homeIds: string[], pointAlerts: { id: string; event: string; expires: string | null; ends: string | null; senderName: string | null; headline: string | null; description: string; instruction: string | null; onset: string | null }[], now: number) {
  const fromAlerts: HazardSummary[] = pointAlerts
    .filter((a) => a.event === "Tornado Warning" || a.event === "Tornado Watch" || a.event === "Flash Flood Warning")
    .map((a) => ({
      id: a.id, kind: a.event === "Tornado Warning" ? "tornadoWarning" : a.event === "Tornado Watch" ? "tornadoWatch" : "flashFloodWarning",
      title: a.event, plain: "", onset: a.onset, expires: a.ends ?? a.expires ?? new Date(now + 3_600_000).toISOString(),
      issuer: a.senderName ?? "National Weather Service", source: "NWS alerts for your point", url: null,
      headline: a.headline, description: a.description, instruction: a.instruction,
    }));
  const fromPolys = hazards.filter((h) => homeIds.includes(h.id));
  const all = activeAt([...fromPolys, ...fromAlerts.filter((a) => !fromPolys.some((p) => p.id === a.id))], now);
  const pick = (k: HazardKind) => all.filter((h) => h.kind === k).sort((a, b) => (b.description ? 1 : 0) - (a.description ? 1 : 0));
  const tor = pick("tornadoWarning")[0] ?? null;
  // Prefer the SPC polygon watch (has the watch number) over the county alert copy.
  const watch = pick("tornadoWatch").sort((a, b) => (/\d/.test(b.title) ? 1 : 0) - (/\d/.test(a.title) ? 1 : 0))[0] ?? null;
  const flood = pick("flashFloodWarning")[0] ?? null;
  return { tornadoWarning: tor, tornadoWatch: watch, flashFloodWarning: flood };
}

export type HazardFC = GeoJSON.FeatureCollection<GeoJSON.Geometry, { id: string; kind: HazardKind; label: string; color: string }>;
/** Map features for the hazards in effect at time t, filtered to enabled kinds. Warnings draw on top. */
export function hazardFeatures(hs: Hazard[], t: number, kinds: HazardKind[]): HazardFC {
  const on = activeAt(hs, t).filter((h) => h.geometry && kinds.includes(h.kind));
  return { type: "FeatureCollection", features: byUrgency(on).reverse().map((h) => ({
    type: "Feature", geometry: h.geometry!, properties: { id: h.id, kind: h.kind, label: hazardLabel(h), color: HAZARD_HEX[h.kind] } })) };
}
