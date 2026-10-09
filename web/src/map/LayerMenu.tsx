import { useState } from "react";
import { LAYER_GROUPS, groupOn, type LayerKey, type ViewMode } from "./layers";

/** Simple line icons (24x24, stroke = currentColor). */
const ICON: Record<string, string> = {
  storm: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM15 12c0-6-4-9-9-9M9 12c0 6 4 9 9 9",
  radar: "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 12L19 5M5.6 18.4A9 9 0 1 1 18.4 18.4M8.5 15.5a5 5 0 1 1 7 0",
  alerts: "M12 3L2 20h20L12 3zM12 10v4M12 17v.5",
  satellite: "M4 14l6-6 4 4-6 6zM14 4l3-1 4 4-1 3M13 11l3-3M3 21c1-3 3-5 6-6",
  wind: "M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8",
  rain: "M12 3C9 8 6 11 6 14a6 6 0 0 0 12 0c0-3-3-6-6-11z",
  outages: "M13 2L4 14h7l-1 8 9-12h-7z",
  water: "M2 15c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2M2 19c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2M12 3v7",
  cameras: "M3 7h4l2-3h6l2 3h4v12H3zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  places: "M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  night: "M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z",
  home: "M3 11l9-8 9 8M5 9v11h14V9",
  eye: "M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5v1",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
};
export const Icon = ({ name, size = 20 }: { name: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[name] ?? ICON.layers} /></svg>
);

/** v0.7 icon layer rail: one button per layer group, plus Standard/Hazards view and "center home". */
export default function LayerMenu({ layers, onSet, mode, onMode, onHome, follow, onFollow }: {
  follow?: boolean; onFollow?: (v: boolean) => void;
  layers: Record<LayerKey, boolean>; onSet: (keys: LayerKey[], on: boolean) => void;
  mode: ViewMode; onMode?: (m: ViewMode) => void; onHome?: () => void;
}) {
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem("stormwatch:layerMenuOpen"); return v == null ? window.innerWidth >= 1400 : v === "1"; } catch { return true; } });
  const toggleOpen = () => setOpen((o) => { try { localStorage.setItem("stormwatch:layerMenuOpen", o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  return (
    <nav className={`layer-rail ${open ? "open" : ""}`} aria-label="Map layers" data-testid="layer-menu">
      <button className="lr-btn lr-head" onClick={toggleOpen} aria-expanded={open} title={open ? "Hide layer names" : "Show layer names"}><Icon name="layers" /><span>Layers</span></button>
      {onMode && <div className="lr-modes" role="group" aria-label="View">
        <button className={mode === "standard" ? "on" : ""} aria-pressed={mode === "standard"} onClick={() => onMode("standard")}>Standard</button>
        <button className={mode === "hazards" ? "on" : ""} aria-pressed={mode === "hazards"} onClick={() => onMode("hazards")} title="Only watches, warnings, cone and path">Hazards</button>
      </div>}
      {LAYER_GROUPS.map((g) => {
        const on = groupOn(layers, g.keys);
        return <button key={g.id} className={`lr-btn ${on ? "on" : ""}`} aria-pressed={on} title={g.hint} data-layer={g.id} onClick={() => onSet(g.keys, !on)}>
          <Icon name={g.id} /><span>{g.label}</span>
        </button>;
      })}
      {onFollow && <button className={`lr-btn follow ${follow ? "on" : ""}`} aria-pressed={!!follow} onClick={() => onFollow(!follow)} title="Keep the storm centered while you move the time slider (drag the map to stop)" data-testid="follow-eye"><Icon name="eye" /><span>Follow the eye</span></button>}
      {onHome && <button className="lr-btn" onClick={onHome} title="Center the map on home"><Icon name="home" /><span>Center home</span></button>}
    </nav>
  );
}
