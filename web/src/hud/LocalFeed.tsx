// "Latest for <place>": newest-first official updates near the selected place (or home, or the first city landmark).
import { useEffect, useRef, useState } from "react";
import type { Snapshot, Storm } from "../types";
import { ktToMph } from "../format";

export interface FeedItem { id: string; time: string; kind: "alert" | "statement" | "observation" | "report" | "storm" | "power"; title: string; text: string; url: string | null; source: string }
export interface LocalFeedData { office: string | null; station: string | null; checked: string; items: FeedItem[]; errors: string[] }
const REFRESH_MS = 2 * 60_000;
const NEW_MS = 15 * 60_000;
const KIND: Record<FeedItem["kind"], string> = { alert: "ALERT", statement: "NWS", observation: "OBSERVED", report: "REPORT", storm: "HURRICANE CENTER", power: "POWER" };

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
  if (storm?.lastUpdate) extra.push({ id: `nhc:${storm.id}:${storm.advisoryNumber}:${storm.lastUpdate}`, time: storm.lastUpdate, kind: "storm",
    title: `${storm.name}: advisory ${storm.advisoryNumber ?? "?"}`, text: `Center ${Math.abs(storm.lat).toFixed(1)}°${storm.lat >= 0 ? "N" : "S"} ${Math.abs(storm.lon).toFixed(1)}°${storm.lon >= 0 ? "E" : "W"}, top wind ${storm.intensityKt != null ? ktToMph(storm.intensityKt) : "?"} mph${storm.movementSpeedMph != null ? `, moving ${storm.movementSpeedMph} mph` : ""}${point ? `, about ${Math.round(distance(point, storm))} miles from ${point.name}` : ""}.`,
    url: storm.publicAdvisoryUrl ?? "https://www.nhc.noaa.gov/", source: "National Hurricane Center" });
  const pw = snap?.power.local; const pwTime = snap?.feeds.power?.sourceTime ?? snap?.feeds.power?.lastSuccess ?? null;
  const prevPw = useRef<{ count: number; customers: number } | null>(null);
  const [pwChange, setPwChange] = useState<string>("");
  useEffect(() => {
    if (!pw) return;
    const p = prevPw.current;
    if (p && (p.count !== pw.count || p.customers !== pw.totalCustomers)) setPwChange(` (was ${p.customers.toLocaleString()} customers in ${p.count} outages)`);
    prevPw.current = { count: pw.count, customers: pw.totalCustomers };
  }, [pw?.count, pw?.totalCustomers]);
  if (pw && pwTime && snap?.home.configured && point && Math.abs(point.lat - snap.home.lat) < 0.05 && Math.abs(point.lon - snap.home.lon) < 0.05)
    extra.push({ id: `power:${pw.count}:${pw.totalCustomers}`, time: pwTime, kind: "power", title: `Power: ${pw.totalCustomers.toLocaleString()} customers out in ${pw.count} outages (${pw.name})`, text: `Live utility outage feed${pwChange}.`, url: null, source: pw.name });
  const items = mergeFeed(data?.items ?? [], extra);
  for (const i of items) if (!firstSeen.current.has(i.id)) firstSeen.current.set(i.id, loaded.current ? now : 0);
  if (data) loaded.current = true;

  if (!point) return <div className="lf"><p className="tm-text">Set a home in .env or look up a place to see local updates.</p></div>;
  return (
    <div className="lf" data-testid="local-feed">
      {err && <p className="tm-warn">{err} Showing the last updates received.</p>}
      {!data && !err && <p className="tm-text">Loading the latest updates…</p>}
      <ul className="lf-list">
        {items.map((i) => { const fresh = (firstSeen.current.get(i.id) ?? 0) > now - NEW_MS && (firstSeen.current.get(i.id) ?? 0) > 0;
          return <li key={i.id} className={`lf-item k-${i.kind} ${fresh ? "new" : ""}`}>
            <div className="lf-meta"><span className="lf-kind">{KIND[i.kind]}</span>{fresh && <b className="lf-new">NEW</b>}<span>{et(i.time)} · {ago(i.time, now)}</span></div>
            <div className="lf-title">{i.title}</div>
            {i.text && <div className="lf-text">{i.text}</div>}
            <div className="lf-src">{i.source}{i.url && <> · <a href={i.url} target="_blank" rel="noreferrer">source</a></>}</div>
          </li>; })}
      </ul>
      {data?.errors.length ? <p className="tm-src">Not reachable right now: {data.errors.join(", ")}.</p> : null}
      <p className="tm-src">Refreshes every 2 minutes. Official text is shown as issued. Follow your local NWS office and emergency management.</p>
    </div>
  );
}
function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
