import type { Snapshot } from "../types";
import { homeBanner, untilET } from "../hazards";

/**
 * Home-point banners. Tornado warning: big red "Take shelter now" with the official NWS text verbatim.
 * Tornado watch / flash flood warning: smaller amber / green banners. Nothing shows once an alert expires.
 */
export default function HazardBanner({ snap, now }: { snap: Snapshot | null; now: number }) {
  if (!snap?.home.configured) return null;
  const b = homeBanner(snap.hazards ?? [], snap.homeHazardIds ?? [], snap.alerts ?? [], now);
  return <>
    {b.tornadoWarning && <div className="hz-banner tor" role="alert" aria-live="assertive" data-testid="tornado-banner">
      <div className="hz-big">{b.tornadoWarning.title} for your location until {untilET(b.tornadoWarning.expires)} ({b.tornadoWarning.issuer}).</div>
      <div className="hz-act">Take shelter now. Go to a small interior room on the lowest floor, away from windows. If you are in a mobile home or vehicle, get to the closest sturdy building.</div>
      {(b.tornadoWarning.headline || b.tornadoWarning.description || b.tornadoWarning.instruction) && <details open>
        <summary>Official National Weather Service text</summary>
        <pre className="verbatim">{[b.tornadoWarning.headline, b.tornadoWarning.description, b.tornadoWarning.instruction].filter(Boolean).join("\n\n")}</pre>
      </details>}
    </div>}
    {!b.tornadoWarning && b.tornadoWatch && <div className="hz-banner watch" role="status" data-testid="watch-banner">
      Your location is in {b.tornadoWatch.title} until {untilET(b.tornadoWatch.expires)} ({b.tornadoWatch.issuer}). Tornadoes are possible. Know where you will take shelter, and keep alerts on.
    </div>}
    {b.flashFloodWarning && <div className="hz-banner flood" role="alert">
      {b.flashFloodWarning.title} for your location until {untilET(b.flashFloodWarning.expires)} ({b.flashFloodWarning.issuer}). Move to higher ground now. Turn around, don't drown.
    </div>}
  </>;
}
