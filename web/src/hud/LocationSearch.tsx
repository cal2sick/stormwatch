import { useRef, useState } from "react";
import type { EvacInfo } from "../useSelectedPlace";
import type { NearbyOutages, Place } from "../useSelectedPlace";
import { fmtET } from "../time";

const MIN_GAP_MS = 1500; // no autocomplete: one search per click / Enter, at most one every 1.5 s

/** Search box: address, city or ZIP. US Census Geocoder first, OpenStreetMap Nominatim fallback (via this app's server). */
export default function LocationSearch({ place, onPick }: { place: Place | null; onPick: (p: Place | null) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [results, setResults] = useState<Place[]>([]);
  const last = useRef(0);
  const search = async () => {
    const s = q.trim();
    if (s.length < 3) { setMsg("Type at least 3 characters: an address, a city or a ZIP code."); return; }
    if (busy || Date.now() - last.current < MIN_GAP_MS) return;
    last.current = Date.now(); setBusy(true); setMsg(null); setResults([]);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(s)}`); const d = await r.json();
      if (!r.ok) setMsg(d.error ?? "Search failed.");
      else if (!d.results?.length) setMsg("No match. Try adding the city and state, or use a ZIP code.");
      else if (d.results.length === 1) { onPick(d.results[0]); setResults([]); }
      else setResults(d.results);
    } catch { setMsg("Location search is not reachable right now."); }
    setBusy(false);
  };
  return (
    <div className="loc">
      <form className="loc-form" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address, city or ZIP code" aria-label="Search for an address, city or ZIP code" autoComplete="off" maxLength={120} data-testid="loc-input" />
        <button className="btn" type="submit" disabled={busy} data-testid="loc-search">{busy ? "Searching…" : "Search"}</button>
      </form>
      {msg && <p className="tm-text">{msg}</p>}
      {results.length > 0 && <ul className="loc-results">{results.map((r, i) => <li key={i}><button className="btn loc-pick" onClick={() => { onPick(r); setResults([]); }}>{r.name}</button></li>)}</ul>}
      {place && <p className="tm-text" data-testid="loc-selected">Selected: <b>{place.name}</b> <button className="btn" onClick={() => onPick(null)}>Clear</button></p>}
      <p className="tm-src">Your search goes only to the US Census Geocoder (or OpenStreetMap if Census has no match). The selected place is saved only in this browser and is not logged.</p>
    </div>
  );
}

export function OutagesNearby({ data, err }: { data: NearbyOutages | null; err: string | null }) {
  if (err && !data) return <p className="tm-text">{err}</p>;
  if (!data) return <p className="tm-text">Checking outage feeds near this place…</p>;
  const top = data.outages.slice(0, 8);
  return (
    <div className="outages" data-testid="outages-nearby">
      {data.coverage === "point-feed" && <p className="tm-text"><b>{data.outages.length}</b> outage{data.outages.length === 1 ? "" : "s"} within {data.radiusMi} miles, <b>{data.totalCustomers.toLocaleString()}</b> customers out.</p>}
      {data.note && <p className="tm-text">{data.note}</p>}
      {top.length > 0 && <ul className="tm-alerts">{top.map((o, i) => <li key={i}><b>{o.customers.toLocaleString()} customer{o.customers === 1 ? "" : "s"}</b>, {o.distanceMi} miles away · {o.cause ?? "cause unknown"} · {o.etr ? <>estimated fix {fmtET(o.etr)}{o.etrPassed ? " (time passed)" : ""}</> : "no fix time yet"} · {o.source}</li>)}</ul>}
      {data.county && <p className="tm-text">{data.county.name}: {data.county.rows.length ? data.county.rows.map((r) => `${r.utility} ${r.customers.toLocaleString()} out`).join(", ") : "no utilities in this county report to the national feed right now"} <small>({data.county.source})</small></p>}
      {data.feeds.filter((f) => f.status === "error").map((f) => <p key={f.name} className="tm-text">{f.name} feed did not answer. It will retry automatically.</p>)}
      <p className="tm-text">Utility outage maps: {data.links.map((l, i) => <span key={l.url}>{i ? " · " : ""}<a href={l.url} target="_blank" rel="noreferrer">{l.name}</a></span>)}</p>
      <p className="tm-src">Checked {fmtET(data.checked)}. Updates every {Math.round(data.pollSeconds / 60)} minutes while a place is selected. {data.feeds.map((f) => f.credit).filter(Boolean).join(" · ")}</p>
    </div>
  );
}

/** "Am I in an evacuation zone?" for the selected place (Florida Know Your Zone). */
export function EvacZone({ data, err }: { data: EvacInfo | null; err: string | null }) {
  if (err) return <p className="tm-text">{err}</p>;
  if (!data) return <p className="tm-text">Checking the Florida evacuation zone map…</p>;
  const links = <p className="tm-src">{data.links.map((l, i) => <span key={l.url}>{i ? " · " : ""}<a href={l.url} target="_blank" rel="noreferrer">{l.name}</a></span>)} · Source: {data.source}</p>;
  if (!data.covered) return <><p className="tm-text">Evacuation zone lookup covers Florida only. Check your county or parish emergency management website.</p>{links}</>;
  return <>
    {data.zone ? <p className="tm-big" data-testid="evac-zone">This place is in <b>Evacuation Zone {data.zone}</b>{data.county ? ` (${data.county} County)` : ""}.</p>
      : <p className="tm-big" data-testid="evac-zone">This place is <b>not in a mapped Florida evacuation zone</b>{data.county ? ` (${data.county} County)` : ""}.</p>}
    <p className="tm-text">A zone is a planning area, not an order. Your county announces which zones must evacuate. If your zone is called, leave. {data.zone ? "Zone A floods first." : "You may still need to leave if you live in a mobile home or a flood-prone spot."}</p>
    {links}
  </>;
}
