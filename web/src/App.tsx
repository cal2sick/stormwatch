import { useEffect, useState } from "react";
import MapView from "./map/MapView";
import ThreatLadder from "./hud/ThreatLadder";
import AlertList from "./hud/AlertList";
import VitalsPanel from "./hud/VitalsPanel";
import FeedTicker from "./hud/FeedTicker";
import RangeScope from "./hud/RangeScope";
import GridOverlay from "./hud/GridOverlay";
import SitrepReadout from "./hud/SitrepReadout";
import { dtg } from "./hud/sitrep";
import HourlyStrip from "./hud/HourlyStrip";
import PowerPanel from "./hud/PowerPanel";
import RiversPanel from "./hud/RiversPanel";
import BuoysPanel from "./hud/BuoysPanel";
import EventLog from "./hud/EventLog";
import LinksPanel from "./hud/LinksPanel";
import Panel from "./hud/Panel";
import TimeMachine, { type SliderState } from "./hud/TimeMachine";
import { useSnapshot } from "./useSnapshot";
import { useGis } from "./useGis";
import { useAdvisory, useTimeline } from "./useTimeline";
import { useNow } from "./useNow";
import { speak, useAlerts } from "./useAlerts";
import { DEFAULT_LAYERS, effectiveLayers, type LayerKey, type ViewMode } from "./map/layers";
import HazardBanner from "./hud/HazardBanner";
import HazardsPanel from "./hud/HazardsPanel";
import { useHazards } from "./useHazards";
import { threatColor } from "./format";
import { stormLabel } from "./map/sliderView";
import { useSelectedPlace } from "./useSelectedPlace";
import LocationSearch, { OutagesNearby } from "./hud/LocationSearch";

function usePref<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem("stormwatch:" + key); return s ? { ...init, ...JSON.parse(s) } : init; } catch { return init; } });
  useEffect(() => { try { localStorage.setItem("stormwatch:" + key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV] as const;
}

export default function App() {
  const { snap, connected } = useSnapshot();
  const gis = useGis(snap?.gisVersion);
  const now = useNow(1000);
  const [layers, setLayers] = usePref<Record<LayerKey, boolean>>("layers", DEFAULT_LAYERS);
  const [prefs, setPrefs] = usePref("prefs", { voice: false, notify: false, lowBw: false, mode: "standard" as ViewMode });
  const hazards = useHazards(snap?.hazardsVersion);
  const [stormId, setStormId] = useState<string | null>(null);
  const [tm, setTm] = useState<SliderState | null>(null);
  const [more, setMore] = useState(false);
  const timelines = useTimeline(snap?.gisVersion);
  const [advPick, setAdvPick] = useState<string | null>(null);
  useAlerts(snap, prefs.voice, prefs.notify);
  const { place, setPlace, weather: placeWx, outages: placeOut, outageErr } = useSelectedPlace();
  // Readouts (distance, wind at the place, alerts) use the searched place when one is selected; else .env home.
  const readSnap = snap && place ? { ...snap, home: { name: place.name.split(",")[0], lat: place.lat, lon: place.lon, configured: true },
    forecast: placeWx?.forecast ?? null, alerts: placeWx?.alerts ?? [] } : snap;
  const hazardTime = tm?.time ?? now;
  const shownLayers = effectiveLayers(layers, prefs.mode);

  // Selected storm: the user's pick if still active, else the nearest (never chosen by name).
  const storm = snap?.storms.find((s) => s.id === stormId) ?? snap?.storms[0];
  const tl = storm ? timelines[storm.id.toLowerCase()] : undefined;
  const pickedAdv = useAdvisory(storm?.id.toLowerCase(), advPick);
  useEffect(() => { setAdvPick(null); }, [storm?.id]);
  // If this device has been cut off long enough that every feed is old, show DATA STALE locally too
  // (the server's own DATA STALE can't reach us while we're disconnected).
  const feeds = Object.values(snap?.feeds ?? {});
  const allStaleLocal = feeds.length > 0 && feeds.every((f) => !f.lastSuccess || now - Date.parse(f.lastSuccess) > 30 * 60_000);
  const view = snap && allStaleLocal && snap.threat.level !== "DATA STALE"
    ? { ...snap, threat: { ...snap.threat, level: "DATA STALE" as const, reasons: ["No fresh data for 30+ min on this device. Check official sources.", ...snap.threat.reasons.map((r) => `(last known) ${r}`)] } }
    : snap;
  // A searched place gets its own threat level (same rules, its own alerts and distance); else the .env home.
  const threatView = view && place && placeWx?.threat && view.threat.level !== "DATA STALE" ? { ...view, threat: { ...placeWx.threat, reasons: [`For ${place.name.split(",")[0]} (the place you looked up):`, ...placeWx.threat.reasons] } } : view;
  const level = threatView?.threat.level ?? "DATA STALE";
  useEffect(() => { document.documentElement.style.setProperty("--threat", threatColor[level]); }, [level]);

  const toggleVoice = () => setPrefs((p) => { const v = !p.voice; if (v) speak("Voice alerts on."); else speechSynthesis?.cancel(); return { ...p, voice: v }; });
  const toggleNotify = async () => {
    if (!("Notification" in window) || !window.isSecureContext) { alert("Browser notifications need http://localhost. Use VOICE instead."); return; }
    if (!prefs.notify && Notification.permission !== "granted") await Notification.requestPermission();
    setPrefs((p) => ({ ...p, notify: !p.notify && Notification.permission === "granted" }));
  };

  return (
    <div className={`hud lvl-${level.replace(" ", "-").toLowerCase()}`}>
      <GridOverlay />
      <div className="banner" role="note">For information only. Follow your local National Weather Service office and emergency management. Evacuation orders override this app.</div>
      {snap && !snap.home.configured && <div className="banner setup" role="alert">
        No location set, so the map shows storms only. To get distance, local alerts, winds and a threat level for your place: copy <code>.env.example</code> to <code>.env</code>, set <code>HOME_LAT</code> and <code>HOME_LON</code> (decimal degrees, e.g. from a map app), then restart with <code>npm start</code>. Your location stays on your computer.
      </div>}
      <HazardBanner snap={snap} now={now} />
      <header className="topbar">
        <div className="brand">
          <div className="title">STORMWATCH</div>
          <div className="subtitle">{!snap ? "—" : snap.home.configured ? `${snap.home.name} · ${Math.abs(snap.home.lat).toFixed(2)}°${snap.home.lat >= 0 ? "N" : "S"} ${Math.abs(snap.home.lon).toFixed(2)}°${snap.home.lon >= 0 ? "E" : "W"}` : "No location set"}</div>
        </div>
        {(snap?.storms.length ?? 0) > 1 && (
          <div className="storm-tabs">
            {snap!.storms.slice(0, 4).map((s) => <button key={s.id} className={`btn ${s.id === storm?.id ? "on" : ""}`} onClick={() => setStormId(s.id)}>{s.name}{snap!.home.configured ? `, ${Math.round(s.distanceMi)} miles away` : ""}</button>)}
          </div>
        )}
        <ThreatLadder snap={threatView} />
        <div className="top-right">
          <div className="clock">{new Date(now).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })}<small> ET</small><span className="zulu">{dtg(new Date(now).toISOString())}</span></div>
          <div className="toggles">
            <span className={`live ${connected ? "on" : ""}`}>{connected ? "Live" : "Connection lost, retrying"}</span>
            <button className={`btn ${prefs.voice ? "on" : ""}`} onClick={toggleVoice} title="Speak new warnings (tap to enable)">voice</button>
            <button className={`btn ${prefs.notify ? "on" : ""}`} onClick={toggleNotify} title="Browser notifications">notify</button>
            <button className={`btn ${prefs.lowBw ? "on" : ""}`} onClick={() => setPrefs((p) => ({ ...p, lowBw: !p.lowBw }))} title="Stop radar + map tiles">low-bw</button>
          </div>
        </div>
      </header>
      <main className={`grid ${more ? "" : "simple"}`}>
        <aside className="col left">
          <Panel title="Where will the storm be? Pick a time" feed={snap?.feeds.nhcgis ?? snap?.feeds.nhc} source="National Hurricane Center forecast, filled in between forecast points" area="timemachine"
            right={<button className="btn" onClick={() => setMore((v) => !v)}>{more ? "Show less" : "Show more panels"}</button>}>
            <TimeMachine snap={readSnap} storm={storm} gis={storm ? gis[storm.id] : undefined} tl={tl} adv={advPick ? pickedAdv : null} onAdv={setAdvPick} now={now} onState={setTm} />
          </Panel>
          <Panel title="Look up a place" source="US Census Geocoder, OpenStreetMap Nominatim fallback" time={null} area="place">
            <LocationSearch place={place} onPick={setPlace} />
          </Panel>
          {place && <Panel title={`Power outages near ${place.name.split(",")[0]}`} source="utility outage feeds (config/outage-sources.json), ORNL ODIN" time={placeOut?.checked ?? null} area="place-outages">
            <OutagesNearby data={placeOut} err={outageErr} />
          </Panel>}
          <Panel title={place ? `Threat level for ${place.name.split(",")[0]} and why` : "Your threat level and why"} source="rules in config/thresholds.json over NWS + NHC" time={snap?.generatedAt ?? null} area="threat" className="threat-panel">
            <ThreatLadder snap={threatView} variant="full" />
          </Panel>
          <AlertList snap={snap} area="alerts" />
          <HazardsPanel snap={snap} time={hazardTime} area="hazards" />
          {more && <VitalsPanel snap={snap} storm={storm} now={now} area="vitals" />}
          {more && snap?.home.configured && <Panel title="Storm position around your home" feed={snap?.feeds.nhc} source="NHC position + forecast points" area="scope">
            <RangeScope snap={snap} storm={storm} gis={storm ? gis[storm.id] : undefined} />
          </Panel>}
        </aside>
        <section className="col center">
          <div className="map-frame" data-area="map">
            <MapView snap={snap} storm={storm} gis={storm ? gis[storm.id] : undefined} layers={shownLayers}
              place={place} placeOutages={placeOut?.outages ?? []}
              hazards={hazards} hazardTime={hazardTime} mode={prefs.mode} onMode={(mode) => setPrefs((p) => ({ ...p, mode }))}
              ghost={tm && storm ? { lat: tm.lat, lon: tm.lon, time: tm.time, trail: tm.trail, uncertaintyMi: tm.uncertaintyMi, live: tm.live, radii: tm.radii, label: stormLabel(storm.name, tm.time, tm.windMph, tm.category, tm.live) } : null}
              onToggle={(k: LayerKey) => { setPrefs((p) => ({ ...p, mode: "standard" })); setLayers((l) => ({ ...l, [k]: !shownLayers[k] })); }} lowBandwidth={prefs.lowBw} />
          </div>
          {more && <div className="center-bottom">
            <SitrepReadout snap={snap} storm={storm} onSpeak={speak} area="sitrep" />
            <HourlyStrip snap={snap} area="hourly" />
          </div>}
        </section>
        {more && <aside className="col right">
          <PowerPanel snap={snap} area="power" />
          <RiversPanel snap={snap} area="rivers" />
          <BuoysPanel snap={snap} area="buoys" />
          <EventLog snap={snap} area="events" />
          <LinksPanel area="links" office={snap?.forecast?.office ?? null} extra={storm?.publicAdvisoryUrl ? [{ name: `NHC advisory ${storm.advisoryNumber ?? ""}`, url: storm.publicAdvisoryUrl }] : []} />
        </aside>}
      </main>
      <FeedTicker snap={snap} now={now} />
    </div>
  );
}
