import { useState } from "react";
import LocationSearch from "./LocationSearch";
import type { Place } from "../useSelectedPlace";
import { FSU_HOME } from "../useHome";

/** Shows the current home and lets you change it (search or map click), use FSU, or reset to the default. */
export default function HomePanel({ home, source, browserHome, onSet, picking, onPicking }: {
  home: { name: string; lat: number; lon: number } | null; source: "browser" | "env" | "default" | "none";
  browserHome: Place | null; onSet: (p: Place | null) => void; picking: boolean; onPicking: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const srcText = source === "browser" ? "set in this browser" : source === "env" ? "from your .env file" : source === "default" ? "default for everyone" : "not set";
  return (
    <div className="home-panel" data-testid="home-panel">
      <div className="home-row">
        <span>Home: <span className="home-name" data-testid="home-name">{home?.name ?? "not set"}</span> <small>({srcText})</small></span>
        <button className="btn on" data-testid="change-home" onClick={() => { setOpen((v) => !v); onPicking(false); }}>{open ? "Close" : "Change home"}</button>
      </div>
      {open && <>
        <p className="tm-text">Search for your home, or click a spot on the map. Saved only in this browser. Distance, threat level, wind, alerts, outages and the local feed all follow it.</p>
        <LocationSearch place={null} onPick={(p) => { if (p) { onSet({ ...p, source: "browser" }); setOpen(false); } }} />
        <div className="home-row">
          <button className={`btn ${picking ? "picking" : ""}`} data-testid="home-pick-map" onClick={() => onPicking(!picking)}>{picking ? "Now click your home on the map… (cancel)" : "Click on the map"}</button>
          <button className="btn" data-testid="home-fsu" onClick={() => { onSet({ ...FSU_HOME, source: "browser" }); setOpen(false); }}>Use Florida State University</button>
          {browserHome && <button className="btn" data-testid="home-reset" onClick={() => { onSet(null); setOpen(false); }}>Reset to default</button>}
        </div>
        <p className="tm-src">Reset to default uses HOME_LAT/HOME_LON from .env if set, otherwise Florida State University.</p>
      </>}
    </div>
  );
}
