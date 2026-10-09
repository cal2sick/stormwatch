const TZ = "America/New_York";

/** "Oct 9, 3:05 PM ET" */
export const fmtET = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—";
/** "Fri 3:05 PM ET" */
export const fmtDayET = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET" : "—";
/** "3:05 PM" */
export const fmtClockET = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "—";
/** "3p" for compact hour labels */
export const fmtHourET = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric" }).replace(":00", "").replace(" AM", "a").replace(" PM", "p");

export type Stale = "fresh" | "amber" | "red";
/** green = fresh, amber after 2x poll, red after 6x (spec §3). */
export function staleness(lastSuccess: string | null | undefined, pollSeconds: number, now = Date.now()): Stale {
  if (!lastSuccess) return "red";
  const age = (now - Date.parse(lastSuccess)) / 1000;
  return age > pollSeconds * 6 ? "red" : age > pollSeconds * 2 ? "amber" : "fresh";
}

/** "in 2h 15m" / "12m ago" */
export function rel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const m = Math.round((Date.parse(iso) - now) / 60_000);
  const a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
  const s = h ? `${h}h ${mm}m` : `${mm}m`;
  return m >= 0 ? `in ${s}` : `${s} ago`;
}
