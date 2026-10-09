// What the map should show for the slider time. Pure functions (no DOM), unit tested.

export interface RadarFrame { time: string; path: string }
export type RadarPick =
  | { mode: "live"; index: number; note: null }
  | { mode: "past"; index: number; frameTime: string; note: string }
  | { mode: "past-none"; index: -1; note: string }
  | { mode: "future"; index: -1; note: string };

export const RADAR_FUTURE_NOTE = "Radar shows observed rain only. Not a forecast.";
const MAX_GAP = 15 * 60_000; // a frame counts as "at" the slider time if within 15 min

/** Live: animate the loop. Past: the frame closest to the slider time. Future: no radar. */
export function radarForTime(frames: RadarFrame[], t: number, now: number, live: boolean): RadarPick {
  if (live) return { mode: "live", index: frames.length - 1, note: null };
  if (t > now + 60_000) return { mode: "future", index: -1, note: RADAR_FUTURE_NOTE };
  let best = -1, gap = Infinity;
  frames.forEach((f, i) => { const g = Math.abs(Date.parse(f.time) - t); if (g < gap) { gap = g; best = i; } });
  if (best < 0 || gap > MAX_GAP) {
    const first = frames[0]?.time;
    return { mode: "past-none", index: -1, note: `No radar image for this time. Radar history only goes back to ${first ? fmt(first) : "the last hour or two"}.` };
  }
  return { mode: "past", index: best, frameTime: frames[best].time, note: `Radar image from ${fmt(frames[best].time)} (closest to the selected time).` };
}
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";

/** Pan only when the point (screen px) has left the central `inner` share of the map. No jitter while it stays inside. */
export function needsPan(x: number, y: number, width: number, height: number, inner = 0.7): boolean {
  const mx = (width * (1 - inner)) / 2, my = (height * (1 - inner)) / 2;
  return x < mx || x > width - mx || y < my || y > height - my;
}

/** Label for the one main storm icon: name, selected time, wind in mph, category. */
export function stormLabel(name: string, time: number, windMph: number | null, category: string, live: boolean): string {
  const when = new Date(time).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  return `${name} · ${live ? "Now, " : ""}${when} ET · ${windMph ?? "?"} mph · ${category}`;
}
