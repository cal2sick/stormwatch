import { useState } from "react";
import type { Snapshot } from "../types";
import { alertHex, homeBanner, untilET } from "../hazards";
import { alertAction, alertRank, plain } from "../plain";

export const eventColor = alertHex;

export interface BarItem { id: string; title: string; event: string; until: string | null; issuer: string | null; action: string | null; color: string }

/** v0.7.1: every alert in effect at home, deduplicated by event, most urgent first. */
export function alertBarItems(snap: Snapshot, now: number): BarItem[] {
  const b = homeBanner(snap.hazards ?? [], snap.homeHazardIds ?? [], snap.alerts ?? [], now);
  const items: BarItem[] = [];
  const add = (it: BarItem) => { if (!items.some((x) => x.event === it.event)) items.push(it); };
  for (const h of [b.tornadoWarning, b.flashFloodWarning, b.tornadoWatch]) if (h) {
    const event = h.kind === "tornadoWarning" ? "Tornado Warning" : h.kind === "flashFloodWarning" ? "Flash Flood Warning" : "Tornado Watch";
    add({ id: h.id, title: h.title, event, until: h.expires, issuer: h.issuer, action: alertAction(event), color: eventColor(event) });
  }
  for (const a of snap.alerts ?? []) {
    const end = a.ends ?? a.expires;
    if (end && Date.parse(end) <= now) continue;
    if (a.onset && Date.parse(a.onset) > now) continue;
    add({ id: a.id, title: a.event, event: a.event, until: end, issuer: a.senderName, action: alertAction(a.event), color: eventColor(a.event) });
  }
  return items.sort((x, y) => alertRank(x.event) - alertRank(y.event));
}

/**
 * Home alerts. Tornado warning: big red "Take shelter now" with the official National Weather Service text verbatim.
 * Everything else: ONE compact bar (most urgent alert first, "+N more" opens the rest), so alerts never stack up.
 */
const DKEY = "stormwatch:dismissed-alerts";
/** Dismissal key: alert id + event, so a NEW or UPGRADED alert (new id or new event) always shows again. */
export const dismissKey = (i: Pick<BarItem, "id" | "event">) => `${i.id}|${i.event}`;
function useDismissed() {
  const [d, setD] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(DKEY) ?? "[]"); } catch { return []; } });
  const add = (keys: string[]) => setD((x) => { const n = [...new Set([...x, ...keys])].slice(-200); try { localStorage.setItem(DKEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return [d, add] as const;
}

export default function HazardBanner({ snap, now }: { snap: Snapshot | null; now: number }) {
  const [open, setOpen] = useState(false);
  const [dismissed, dismiss] = useDismissed();
  if (!snap?.home.configured) return null;
  const b = homeBanner(snap.hazards ?? [], snap.homeHazardIds ?? [], snap.alerts ?? [], now);
  const torKey = b.tornadoWarning ? dismissKey({ id: b.tornadoWarning.id, event: "Tornado Warning" }) : null;
  const torBig = !!b.tornadoWarning && !dismissed.includes(torKey!);
  // A dismissed tornado warning drops into the compact bar (it never disappears entirely while in effect).
  const all = alertBarItems(snap, now);
  const items = all.filter((i) => (i.event === "Tornado Warning" ? !torBig : !dismissed.includes(dismissKey(i))));
  const top = items[0];
  return <>
    {torBig && b.tornadoWarning && <div className="hz-banner tor" role="alert" aria-live="assertive" data-testid="tornado-banner">
      <button className="x-close" aria-label="Make this warning smaller" title="Make smaller (it stays in the alert bar while in effect)" onClick={() => dismiss([torKey!])}>✕</button>
      <div className="hz-big">{b.tornadoWarning.title} for your location until {untilET(b.tornadoWarning.expires)} ({b.tornadoWarning.issuer}).</div>
      <div className="hz-act">Take shelter now. Go to a small interior room on the lowest floor, away from windows. If you are in a mobile home or vehicle, get to the closest sturdy building.</div>
      {(b.tornadoWarning.headline || b.tornadoWarning.description || b.tornadoWarning.instruction) && <details open>
        <summary>Official National Weather Service text</summary>
        <pre className="verbatim">{[b.tornadoWarning.headline, b.tornadoWarning.description, b.tornadoWarning.instruction].filter(Boolean).join("\n\n")}</pre>
      </details>}
    </div>}
    {top && <div className={`alert-bar ${open ? "open" : ""}`} role="status" data-testid="alert-bar" style={{ ["--ac" as string]: top.color }}>
      <div className="ab-row">
        <span className="ab-tag">Alert for your home</span>
        <b className="ab-title" data-testid={top.event === "Tornado Watch" ? "watch-banner" : undefined}>{top.title}</b>
        {top.until && <span className="ab-until">until {untilET(top.until)}</span>}
        {top.action && <span className="ab-act">{top.action}</span>}
        {items.length > 1 && <button className="ab-more" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="alert-bar-more">
          {open ? "Show less ▴" : `+${items.length - 1} more ▾`}</button>}
        {!(top.event === "Tornado Warning") && <button className="x-close sm ab-x" aria-label="Hide these alerts" title="Hide these alerts. New or upgraded alerts will show again." data-testid="alert-bar-close"
          onClick={() => { dismiss(items.filter((i) => i.event !== "Tornado Warning").map(dismissKey)); setOpen(false); }}>✕</button>}
      </div>
      {open && <ul className="ab-list">{items.slice(1).map((i) => <li key={i.id} style={{ ["--ac" as string]: i.color }}>
        <b>{i.title}</b>{i.until ? <span> until {untilET(i.until)}</span> : null}{i.issuer ? <span className="ab-iss"> · {plain(i.issuer)}</span> : null}
        {i.action && <div className="ab-act2">{i.action}</div>}
      </li>)}</ul>}
    </div>}
  </>;
}
