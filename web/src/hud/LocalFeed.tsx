// "Latest for <place>": newest-first official updates near the selected place (or home, or the first city landmark).
import { useEffect, useRef, useState } from "react";
import type { Snapshot, Storm } from "../types";
import { compassWords, ktToMph } from "../format";
import { plain } from "../plain";

export interface FeedItem { id: string; time: string; kind: "alert" | "statement" | "observation" | "report" | "storm" | "power" | "river"; title: string; text: string; url: string | null; source: string; full?: string | null }
export interface LocalFeedData { office: string | null; station: string | null; checked: string; items: FeedItem[]; errors: string[] }
const REFRESH_MS = 60_000;
const NEW_MS = 15 * 60_000;
const KIND: Record<FeedItem["kind"], string> = { alert: "Alert", statement: "Weather service statement", observation: "Weather now", report: "Storm report", storm: "Hurricane Center", power: "Power", river: "River" };
/** v0.7.1 filter chips. */
export const CHIPS = [["all", "All"], ["storm", "Storm"], ["alerts", "Alerts"], ["reports", "Reports"], ["power", "Power"], ["weather", "Weather"]] as const;
export type Chip = (typeof CHIPS)[number][0];
export const chipOf = (k: FeedItem["kind"]): Chip => k === "storm" ? "storm" : k === "alert" || k === "statement" ? "alerts" : k === "report" ? "reports" : k === "power" ? "power" : "weather";
const memo = (key: string) => ({ get: <T,>(): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } },
  set: (v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } } });
const sign = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

/** Merge server items with app-side items (storm advisory, power count), newest first, unique ids. */
export function mergeFeed(server: FeedItem[], extra: FeedItem[]): FeedItem[] {
  const m = new Map<string, FeedItem>();
  for (const i of [...server, ...extra]) if (isFinite(Date.parse(i.time))) m.set(i.id, i);
  return [...m.values()].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
const ago = (iso: string, now: number) => { const m = Math.round((now - Date.parse(iso)) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min ago` : `${Math.floor(m / 1440)} d ago`; };
const et = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";

export function useFeedPoint(place: { name: string; lat: number; lon: number } | null, snap: Snapshot | null) {
  const [fallback, setFallback] = useState<{ name: string; lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (place || snap?.home.configured) return;
    fetch("/api/landmarks").then((r) => r.json()).then((d) => { const c = (d.landmarks ?? []).find((l: any) => l.kind === "city"); if (c) setFallback(c); }).catch(() => {});
  }, [!!place, snap?.home.configured]);
  if (place) return { name: place.name.split(",")[0], lat: place.lat, lon: place.lon };
  if (snap?.home.configured) return { name: snap.home.name || "Home", lat: snap.home.lat, lon: snap.home.lon };
  return fallback;
}

export default function LocalFeed({ point, snap, storm, now }: { point: { name: string; lat: number; lon: number } | null; snap: Snapshot | null; storm: Storm | undefined; now: number }) {
  const [data, setData] = useState<LocalFeedData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const firstSeen = useRef(new Map<string, number>());
  const loaded = useRef(false);
  const q = point ? `lat=${point.lat.toFixed(4)}&lon=${point.lon.toFixed(4)}` : null;
  useEffect(() => {
    if (!q) return;
    let stop = false; loaded.current = false; firstSeen.current.clear();
    const load = () => fetch(`/api/localfeed?${q}`).then(async (r) => { const d = await r.json(); if (stop) return; if (r.ok) { setData(d); setErr(null); } else setErr(d.error ?? "Updates are not available right now."); }).catch(() => !stop && setErr("Updates are not available right now."));
    load(); const id = setInterval(load, REFRESH_MS);
    return () => { stop = true; clearInterval(id); };
  }, [q]);
  // App-side items: NHC advisory / position, and the local power outage count (only for the home point).
  const extra: FeedItem[] = [];
  // Storm: each new advisory or intermediate position, with what changed since the previous one (remembered on this device).
  const advKey = storm ? `${storm.advisoryNumber}:${storm.lastUpdate}` : "";
  const prevAdv = useRef<{ key: string; mph: number | null; mb: number | null; adv: string | null } | null>(null);
  const [advChange, setAdvChange] = useState("");
  useEffect(() => {
    if (!storm) return;
    const m = memo(`stormwatch:lastadv:${storm.id}`);
    const cur = { key: advKey, mph: ktToMph(storm.intensityKt), mb: storm.pressureMb ?? null, adv: storm.advisoryNumber ?? null };
    const saved = m.get<{ key: string; mph: number | null; mb: number | null; adv: string | null; prev?: { mph: number | null; mb: number | null; adv: string | null } }>();
    let prev = saved && saved.key !== cur.key ? saved : saved?.prev ?? null;
    if (!saved || saved.key !== cur.key) m.set({ ...cur, prev: saved && saved.key !== cur.key ? { mph: saved.mph, mb: saved.mb, adv: saved.adv } : null });
    if (prev) {
      const parts: string[] = [];
      if (cur.mph != null && prev.mph != null) parts.push(cur.mph === prev.mph ? "winds unchanged" : `winds ${cur.mph > prev.mph ? "up" : "down"} ${Math.abs(cur.mph - prev.mph)} mph`);
      if (cur.mb != null && prev.mb != null) parts.push(cur.mb === prev.mb ? "pressure unchanged" : `pressure ${cur.mb < prev.mb ? "down" : "up"} ${Math.abs(cur.mb - prev.mb)} millibars${cur.mb < prev.mb ? " (strengthening)" : " (weakening)"}`);
      setAdvChange(parts.length ? ` Since advisory ${prev.adv ?? "before"}: ${parts.join(", ")}.` : "");
    }
    prevAdv.current = cur;
  }, [storm?.id, advKey]);
  if (storm?.lastUpdate) extra.push({ id: `nhc:${storm.id}:${storm.advisoryNumber}:${storm.lastUpdate}`, time: storm.lastUpdate, kind: "storm",
    title: `${storm.name}: ${/[A-Z]$/i.test(String(storm.advisoryNumber ?? "")) ? "intermediate advisory" : "advisory"} ${Number.parseInt(String(storm.advisoryNumber ?? "?"), 10) || storm.advisoryNumber || "?"}${/[A-Z]$/i.test(String(storm.advisoryNumber ?? "")) ? String(storm.advisoryNumber).slice(-1) : ""}`,
    text: `Center at ${Math.abs(storm.lat).toFixed(1)}°${storm.lat >= 0 ? "N" : "S"}, ${Math.abs(storm.lon).toFixed(1)}°${storm.lon >= 0 ? "E" : "W"}${point ? `, about ${Math.round(distance(point, storm))} miles from ${point.name}` : ""}. Top steady winds ${storm.intensityKt != null ? ktToMph(storm.intensityKt) : "?"} mph${storm.pressureMb != null ? `, pressure ${storm.pressureMb} millibars` : ""}${storm.movementSpeedMph != null ? `, moving ${storm.movementDirDeg != null ? compassWords(storm.movementDirDeg) + " " : ""}at ${storm.movementSpeedMph} mph` : ""}.${advChange}`,
    url: storm.publicAdvisoryUrl ?? "https://www.nhc.noaa.gov/", source: "National Hurricane Center" });
  // Alerts that ended since the last check (the server only lists active ones).
  const seenAlerts = useRef<Map<string, string>>(new Map());
  const [ended, setEnded] = useState<FeedItem[]>([]);
  const alertIds = (data?.items ?? []).filter((i) => i.kind === "alert").map((i) => i.id).join(",");
  useEffect(() => {
    if (!data) return;
    const cur = new Map((data.items ?? []).filter((i) => i.kind === "alert").map((i) => [i.id, i.title.replace(/^Updated: /, "")]));
    const gone = [...seenAlerts.current].filter(([id, ev]) => !cur.has(id) && ![...cur.values()].includes(ev));
    if (gone.length) setEnded((e) => [...gone.map(([id, ev]) => ({ id: `ended:${id}`, time: new Date().toISOString(), kind: "alert" as const, title: `Ended: ${ev}`, text: `The National Weather Service no longer lists this alert for ${point?.name ?? "this place"}.`, url: null, source: "National Weather Service" })), ...e].slice(0, 10));
    seenAlerts.current = cur;
  }, [alertIds]);
  extra.push(...ended);
  // River gauges that are rising (home only).
  for (const g of snap?.gauges ?? []) if (g.trend === "rising" && g.time && (g.change3hFt ?? 0) >= 0.3)
    extra.push({ id: `river:${g.id}:${g.time}`, time: g.time, kind: "river", title: `River rising: ${g.name}`, text: `Up ${g.change3hFt} ft in the last 3 hours, now ${g.stageFt ?? "?"} ft.`, url: `https://waterdata.usgs.gov/monitoring-location/${g.id}/`, source: "U.S. Geological Survey" });
  const pw = snap?.power.local; const pwTime = snap?.feeds.power?.sourceTime ?? snap?.feeds.power?.lastSuccess ?? null;
  const prevPw = useRef<{ count: number; customers: number } | null>(null);
  const [pwChange, setPwChange] = useState<string>("");
  useEffect(() => {
    if (!pw) return;
    const p = prevPw.current;
    if (p && (p.count !== pw.count || p.customers !== pw.totalCustomers)) setPwChange(` ${sign(pw.totalCustomers - p.customers)} customers since the last check (was ${p.customers.toLocaleString()}).`);
    prevPw.current = { count: pw.count, customers: pw.totalCustomers };
  }, [pw?.count, pw?.totalCustomers]);
  if (pw && pwTime && snap?.home.configured && point && Math.abs(point.lat - snap.home.lat) < 0.05 && Math.abs(point.lon - snap.home.lon) < 0.05)
    extra.push({ id: `power:${pw.count}:${pw.totalCustomers}`, time: pwTime, kind: "power", title: `Power: ${pw.totalCustomers.toLocaleString()} customers out in ${pw.count} outages`, text: `${pw.name}, live outage map.${pwChange}`, url: null, source: pw.name });
  // Power for any location: live utility totals whose service area covers the point, with the change since the last check.
  const [areas, setAreas] = useState<any>(null);
  useEffect(() => {
    if (!q) return; let stop = false;
    const load = () => fetch("/api/outage-areas").then((r) => (r.ok ? r.json() : null)).then((d) => !stop && d && setAreas(d)).catch(() => {});
    load(); const id = setInterval(load, REFRESH_MS); return () => { stop = true; clearInterval(id); };
  }, [q]);
  const utilItems: FeedItem[] = [];
  if (point) for (const u of areas?.utilities ?? []) {
    const [x0, y0, x1, y1] = u.bbox ?? []; if (u.kind !== "live" || u.out == null || !u.sourceTime || !(point.lon >= x0 - 0.1 && point.lon <= x1 + 0.1 && point.lat >= y0 - 0.1 && point.lat <= y1 + 0.1)) continue;
    const ser: { t: string; v: number }[] = areas?.history?.series?.[u.id] ?? [];
    const last = ser.at(-1); const prev = last ? [...ser].reverse().find((h) => h.v !== last.v) : undefined;
    const ch = last && prev ? ` ${sign(last.v - prev.v)} customers since ${et(prev.t)}.` : " No change since the last checks.";
    utilItems.push({ id: `util:${u.id}:${u.sourceTime}`, time: u.sourceTime, kind: "power", title: `Power: ${u.out.toLocaleString()} customers out${u.pct != null ? ` (${u.pct}% of ${u.name})` : ` (${u.name})`}`,
      text: `${u.outages != null ? `${u.outages} separate outages.` : ""}${ch}`, url: u.map ?? null, source: u.name });
  }
  if (utilItems.length) for (let k = extra.length - 1; k >= 0; k--) if (extra[k].kind === "power") extra.splice(k, 1);
  extra.push(...utilItems);
  const items = mergeFeed(data?.items ?? [], extra);
  for (const i of items) if (!firstSeen.current.has(i.id)) firstSeen.current.set(i.id, loaded.current ? now : 0);
  if (data) loaded.current = true;

  const [chip, setChip] = useState<Chip>("all");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const counts = Object.fromEntries(CHIPS.map(([c]) => [c, c === "all" ? items.length : items.filter((i) => chipOf(i.kind) === c).length]));
  const shown = chip === "all" ? items : items.filter((i) => chipOf(i.kind) === chip);
  if (!point) return <div className="lf"><p className="tm-text">Set your location (top of this column) or look up a place to see local updates.</p></div>;
  return (
    <div className="lf" data-testid="local-feed">
      <div className="lf-chips" role="group" aria-label="Show only">
        {CHIPS.map(([c, w]) => <button key={c} className={`chip ${chip === c ? "on" : ""}`} aria-pressed={chip === c} onClick={() => setChip(c)} disabled={c !== "all" && !counts[c]}>{w}{counts[c] ? <span className="chip-n">{counts[c]}</span> : null}</button>)}
      </div>
      {err && <p className="tm-warn">{err} Showing the last updates received.</p>}
      {!data && !err && <p className="tm-text">Loading the latest updates…</p>}
      <ul className="lf-list">
        {shown.map((i) => { const fresh = (firstSeen.current.get(i.id) ?? 0) > now - NEW_MS && (firstSeen.current.get(i.id) ?? 0) > 0;
          const open = openIds.has(i.id);
          return <li key={i.id} className={`lf-item k-${i.kind} ${fresh ? "new" : ""}`}>
            <div className="lf-meta"><span className="lf-kind">{KIND[i.kind]}</span>{fresh && <b className="lf-new">NEW</b>}<span className="lf-when"><b>{et(i.time)}</b> · {ago(i.time, now)}</span></div>
            <div className="lf-title">{i.title}</div>
            {i.text && <div className="lf-text">{i.full ? <span className="lf-sumtag">Summary: </span> : null}{i.text}</div>}
            {i.full && <button className="lf-expand" aria-expanded={open} onClick={() => setOpenIds((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}>{open ? "Hide full text ▴" : "Read the full official text ▾"}</button>}
            {i.full && open && <pre className="verbatim lf-full">{i.full}</pre>}
            <div className="lf-src">{plain(i.source)}{i.url && <> · <a href={i.url} target="_blank" rel="noreferrer">source</a></>}</div>
          </li>; })}
        {shown.length === 0 && data && <li className="tm-text">Nothing in this group right now.</li>}
      </ul>
      {data?.errors.length ? <p className="tm-src">Not reachable right now: {data.errors.map((e) => e.replace(/\bNWS\b/g, "Weather Service")).join(", ")}.</p> : null}
      <p className="tm-src">Checks for new updates every minute. Official text is shown as issued. Follow your local National Weather Service office and emergency management.</p>
    </div>
  );
}
function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
