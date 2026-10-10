// v0.7 "When does it hit me?": hour-by-hour rows for one place from the NWS hourly forecast + NWS alerts.
// Pure, so the strip and the tests agree. Never invents gusts: when NWS gives no gust, the steady wind is used and flagged.
import type { HourlyPoint, NwsAlert } from "./types";
import { ALERT_HEX, alertHex } from "./hazards";

export interface HitHour { t: number; wind: number | null; gust: number | null; gustIsWind: boolean; pop: number | null; text: string; alerts: { event: string; color: string }[]; score: number; worst: boolean }
export interface HitSummary { peak: HitHour | null; worstStart: number | null; worstEnd: number | null; firstTsGust: number | null }

/** Same alert colors as the map (one palette everywhere, see hazards.ts ALERT_HEX). */
export const NWS_COLORS = ALERT_HEX;
export const alertColor = alertHex;
/** Wind color by impact band: calm, breezy, tropical-storm force (39+), damaging (58+), hurricane force (74+). */
export const windColor = (mph: number | null) => mph == null ? "#4b5a6a" : mph < 25 ? "#5ee0ff" : mph < 39 ? "#ffd43b" : mph < 58 ? "#ff922b" : mph < 74 ? "#ff4d4f" : "#e14be8";

export function hitTimeline(hourly: HourlyPoint[], alerts: NwsAlert[], now: number, hours = 36): { rows: HitHour[]; summary: HitSummary } {
  const start = Math.floor(now / 3.6e6) * 3.6e6;
  const rows: HitHour[] = hourly.map((h) => ({ h, t: Date.parse(h.time) })).filter(({ t }) => Number.isFinite(t) && t >= start && t < start + hours * 3.6e6)
    .sort((a, b) => a.t - b.t).map(({ h, t }) => {
      const active = alerts.filter((a) => !/statement$/i.test(a.event)).filter((a) => {
        const s = Date.parse(a.onset ?? a.sent ?? "") || -Infinity, e = Date.parse(a.ends ?? a.expires ?? "") || Infinity;
        return s < t + 3.6e6 && e > t;
      });
      const gust = h.gustMph ?? null, wind = h.windMph ?? null;
      return { t, wind, gust: gust ?? wind, gustIsWind: gust == null && wind != null, pop: h.pop ?? null, text: (h as any).shortForecast ?? "",
        alerts: [...new Map(active.map((a) => [a.event, { event: a.event, color: alertColor(a.event) }])).values()], score: Math.max(gust ?? 0, wind ?? 0), worst: false };
    });
  const peak = rows.reduce<HitHour | null>((m, r) => (!m || r.score > m.score ? r : m), null);
  let worstStart: number | null = null, worstEnd: number | null = null;
  if (peak && peak.score >= 20) {
    const i = rows.indexOf(peak); let a = i, b = i;
    while (a > 0 && rows[a - 1].score >= peak.score - 5) a--;
    while (b < rows.length - 1 && rows[b + 1].score >= peak.score - 5) b++;
    for (let k = a; k <= b; k++) rows[k].worst = true;
    worstStart = rows[a].t; worstEnd = rows[b].t + 3.6e6;
  }
  const ts = rows.find((r) => (r.gust ?? 0) >= 39);
  return { rows, summary: { peak, worstStart, worstEnd, firstTsGust: ts?.t ?? null } };
}
