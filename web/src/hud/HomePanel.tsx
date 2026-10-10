import { useState } from "react";
import LocationSearch from "./LocationSearch";
import type { Place } from "../useSelectedPlace";

/** Your location: shows it and lets you set / change it (search or map click) or clear it. Saved only in this browser. */
export default function HomePanel({ home, source, browserHome, onSet, picking, onPicking, loading = false }: {
  loading?: boolean;
  home: { name: string; lat: number; lon: number } | null; source: "browser" | "env" | "default" | "none";
  browserHome: Place | null; onSet: (p: Place | null) => void; picking: boolean; onPicking: (v: boolean) => void;
}) {
  const [openPick, setOpen] = useState<boolean | null>(null);
  const open = openPick ?? (!loading && !home);
  const srcText = source === "browser" ? "saved only in this browser" : source === "env" ? "from your .env file" : null;
  return (
    <div className="home-panel" data-testid="home-panel">
      <div className="home-row">
        {home ? <span>Your location: <span className="home-name" data-testid="home-name">{home.name}</span>{srcText && <small> ({srcText})</small>}</span>
          : <span data-testid="home-name">No location set. Set one to see your risk, winds, alerts and outages.</span>}
        <button className="btn on" data-testid="change-home" onClick={() => { setOpen(!open); onPicking(false); }}>{open ? "Close" : home ? "Change location" : "Set your location"}</button>
      </div>
      {open && <>
        <p className="tm-text">Search for an address or place, or click a spot on the map. It is saved only in this browser and never shared.</p>
        <LocationSearch place={null} onPick={(p) => { if (p) { onSet({ ...p, source: "browser" }); setOpen(false); } }} />
        <div className="home-row">
          <button className={`btn ${picking ? "picking" : ""}`} data-testid="home-pick-map" onClick={() => onPicking(!picking)}>{picking ? "Now click the map… (cancel)" : "Click on the map"}</button>
          {browserHome && <button className="btn" data-testid="home-reset" onClick={() => { onSet(null); setOpen(false); }}>Clear my location</button>}
        </div>
      </>}
    </div>
  );
}
