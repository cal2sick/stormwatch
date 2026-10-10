import { useEffect, useState } from "react";

const KEY = "stormwatch:help-seen-v1";

/** v0.7.1 "What am I looking at?": shows once on first visit, then lives behind the ? button. Esc or ✕ closes it. */
export function useHelp() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) !== "1"; } catch { return false; } });
  const close = () => { setOpen(false); try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } };
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open]);
  return { open, show: () => setOpen(true), close };
}

export function HelpButton({ onClick }: { onClick: () => void }) {
  return <button className="btn help-btn" onClick={onClick} data-testid="help-open" title="What am I looking at?" aria-label="What am I looking at? (help)">
    <span aria-hidden="true" className="help-q">?</span><span className="help-word"> What am I looking at?</span></button>;
}

export function HelpCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-card" role="dialog" aria-label="What am I looking at?" data-testid="help-card">
      <button className="x-close" aria-label="Close" title="Close (Esc)" onClick={onClose} data-testid="help-close">✕</button>
      <h2>What am I looking at?</h2>
      <ul>
        <li><b className="hc-ico" aria-hidden="true">🌀</b><span><b>The spinning storm icon</b> is the hurricane's center at the time shown. Its color shows strength (light yellow = weaker, red = strongest). The shaded cone is where the center may go. Danger can reach well outside it.</span></li>
        <li><b className="hc-ico" aria-hidden="true">⏱</b><span><b>The time slider</b> at the bottom moves the whole map in time: <b className="c-past">blue = past</b>, the red line is <b className="c-now">now</b>, <b className="c-fc">striped amber = forecast</b>. "Back to live" returns to right now.</span></li>
        <li><b className="hc-ico" aria-hidden="true">🎨</b><span><b>Colors:</b> radar goes green (light rain) → yellow → orange → red/purple (very heavy rain, possible hail). Green, yellow, orange, red also mean low → high risk. Open <b>Map key</b> in the layer menu for every color.</span></li>
        <li><b className="hc-ico" aria-hidden="true">⚠</b><span><b>Alerts:</b> the colored bar at the top lists official warnings for your home, most urgent first. Colored shapes on the map are the same warnings. Always follow official orders.</span></li>
      </ul>
      <p className="help-safety"><b>For information only.</b> Follow your local National Weather Service office and emergency management. Evacuation orders always override this app.</p>
      <p className="help-foot">Tap anywhere on the map for that exact spot's weather. Reopen this with the <b>?</b> button at the top.</p>
      <button className="btn on" onClick={onClose} data-testid="help-ok">Got it</button>
    </div>
  );
}
