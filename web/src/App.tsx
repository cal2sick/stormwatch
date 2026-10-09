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
import TidesPanel from "./hud/TidesPanel";
import LocalObsPanel from "./hud/LocalObsPanel";
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
import LocationSearch, { EvacZone, OutagesNearby } from "./hud/LocationSearch";
import OutageSummary from "./hud/OutageSummary";
import { useOutageAreas } from "./useOutageAreas";
import LocalFeed, { useFeedPoint } from "./hud/LocalFeed";
import HomePanel from "./hud/HomePanel";
import { useBrowserHome } from "./useHome";
import { distanceMi } from "./geo";

function usePref<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem("stormwatch:" + key); return s ? { ...init, ...JSON.parse(s) } : init; } catch { return init; } });
  useEffect(() => { try { localStorage.setItem("stormwatch:" + key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV] as const;
}

export default function App() {
  const { snap: rawSnap, connected } = useSnapshot();
  // v0.6.1: a home chosen in this browser ("Change home") overrides .env and the FSU default everywhere in the UI.
  const [browserHome, setBrowserHome] = useBrowserHome();
  const [pickingHome, setPickingHome] = useState(false);
  const snap = rawSnap && browserHome ? { ...rawSnap, home: { name: browserHome.name.split(",")[0], lat: browserHome.lat, lon: browserHome.lon, configured: true, source: "browser" as const },
    storms: rawSnap.storms.map((s) => ({ ...s, distanceMi: distanceMi(browserHome.lat, browserHome.lon, s.lat, s.lon) })) } : rawSnap;
  // Safety banner for a browser home: its own NWS point alerts every 2 min (the server's banner data is for the .env/default home).
  const [homeAlerts, setHomeAlerts] = useState<NonNullable<typeof rawSnap>["alerts"] | null>(null);
  useEffect(() => {
    setHomeAlerts(null); if (!browserHome) return;
    let stop = false;
    const load = () => fetch(`/api/place?lat=${browserHome.lat}&lon=${browserHome.lon}`).then((r) => r.ok ? r.json() : null).then((d) => { if (!stop && d) setHomeAlerts(d.alerts ?? []); }).catch(() => {});
    load(); const id = setInterval(load, 120_000); return () => { stop = true; clearInterval(id); };
  }, [browserHome?.lat, browserHome?.lon]);
  const homeSource = browserHome ? "browser" as const : !rawSnap?.home.configured ? "none" as const : rawSnap.home.source === "env" ? "env" as const : "default" as const;
  const gis = useGis(snap?.gisVersion);
  const now = useNow(1000);
  const [layers, setLayers] = usePref<Record<LayerKey, boolean>>("layers", DEFAULT_LAYERS);
  const [prefs, setPrefs] = usePref("prefs", { voice: false, notify: false, lowBw: false, mode: "standard" as ViewMode, smoothRadar: true });
  const hazards = useHazards(snap?.hazardsVersion);
  const [stormId, setStormId] = useState<string | null>(null);
  const [tm, setTm] = useState<SliderState | null>(null);
  const [jump, setJump] = useState<{ t: number | null; seq: number }>({ t: null, seq: 0 });
  const [more, setMore] = useState(false);
  const timelines = useTimeline(snap?.gisVersion);
  const [advPick, setAdvPick] = useState<string | null>(null);
  useAlerts(snap, prefs.voice, prefs.notify);
  const { place, point, setPlace, weather: placeWx, outages: placeOut, outageErr, evac, evacErr } = useSelectedPlace(browserHome);
  // Readouts (distance, wind at the place, alerts) use the searched place, else the browser home; else the server home (.env or FSU).
  const readSnap = snap && point ? { ...snap, home: { name: point.name.split(",")[0], lat: point.lat, lon: point.lon, configured: true },
    forecast: placeWx?.forecast ?? null, alerts: placeWx?.alerts ?? [] } : snap;
  const hazardTime = tm?.time ?? now;
  const feedPoint = useFeedPoint(point, snap);
  const outageAreas = useOutageAreas();
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
  const threatView = view && point && placeWx?.threat && view.threat.level !== "DATA STALE" ? { ...view, threat: { ...placeWx.threat, reasons: [`For ${point.name.split(",")[0]}${place ? " (the place you looked up)" : " (your home)"}:`, ...placeWx.threat.reasons] } } : view;
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
      <HazardBanner snap={snap && browserHome ? { ...snap, alerts: homeAlerts ?? [], homeHazardIds: [] } : snap} now={now} />
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
          <Panel title="Your home" source="saved only in this browser; default Florida State University" time={null} area="home">
            <HomePanel home={snap?.home.configured ? snap.home : null} source={homeSource} browserHome={browserHome} picking={pickingHome} onPicking={setPickingHome}
              onSet={(p) => { setBrowserHome(p); setPickingHome(false); }} />
          </Panel>
          <Panel title="Where will the storm be? Pick a time" feed={snap?.feeds.nhcgis ?? snap?.feeds.nhc} source="National Hurricane Center forecast, filled in between forecast points" area="timemachine"
            right={<button className="btn" onClick={() => setMore((v) => !v)}>{more ? "Show less" : "Show more panels"}</button>}>
            <TimeMachine snap={readSnap} storm={storm} gis={storm ? gis[storm.id] : undefined} tl={tl} adv={advPick ? pickedAdv : null} onAdv={setAdvPick} now={now} onState={setTm} jump={jump} />
          </Panel>
          <Panel title={`Latest for ${feedPoint?.name ?? "your area"}`} source="NWS alerts, statements, observations and storm reports; NHC; utility outage feed" time={null} area="localfeed" className="lf-panel">
            <LocalFeed point={feedPoint} snap={snap} storm={storm} now={now} />
          </Panel>
          <Panel title="Look up a place" source="US Census Geocoder, OpenStreetMap Nominatim fallback" time={null} area="place">
            <LocationSearch place={place} onPick={setPlace} />
          </Panel>
          {point && <Panel title={`Evacuation zone for ${point.name.split(",")[0]}`} source="Florida Division of Emergency Management (Know Your Zone)" time={evac?.checked ?? null} area="place-evac">
            <EvacZone data={evac} err={evacErr} />
          </Panel>}
          {point && <Panel title={`Power outages near ${point.name.split(",")[0]}`} source="utility outage feeds (config/outage-sources.json), ORNL ODIN, EIA-861" time={placeOut?.checked ?? null} area="place-outages">
            <OutageSummary areas={outageAreas} point={point} placeName={point.name.split(",")[0]} fips={placeOut?.county?.fips ?? null} now={now} />
            <OutagesNearby data={placeOut} err={outageErr} />
          </Panel>}
          <Panel title={point ? `Threat level for ${point.name.split(",")[0]} and why` : "Your threat level and why"} source="rules in config/thresholds.json over NWS + NHC" time={snap?.generatedAt ?? null} area="threat" className="threat-panel">
            <ThreatLadder snap={threatView} variant="full" />
          </Panel>
          <LocalObsPanel snap={snap} area="obs" />
          <AlertList snap={readSnap} area="alerts" />
          <HazardsPanel snap={snap} time={hazardTime} area="hazards" />
          {more && <VitalsPanel snap={snap} storm={storm} now={now} area="vitals" />}
          {more && snap?.home.configured && <Panel title="Storm position around your home" feed={snap?.feeds.nhc} source="NHC position + forecast points" area="scope">
            <RangeScope snap={snap} storm={storm} gis={storm ? gis[storm.id] : undefined} />
          </Panel>}
        </aside>
        <section className="col center">
          <div className="map-frame" data-area="map">
            <MapView onJump={(t) => setJump((j) => ({ t, seq: j.seq + 1 }))} snap={snap} storm={storm} gis={storm ? gis[storm.id] : undefined} layers={shownLayers}
              place={place} placeOutages={placeOut?.outages ?? []} evacZones={evac?.countyZones ?? null} outageAreas={outageAreas}
              hazards={hazards} hazardTime={hazardTime} mode={prefs.mode} onMode={(mode) => setPrefs((p) => ({ ...p, mode }))}
              ghost={tm && storm ? { lat: tm.lat, lon: tm.lon, time: tm.time, trail: tm.trail, uncertaintyMi: tm.uncertaintyMi, live: tm.live, radii: tm.radii, label: stormLabel(storm.name, tm.time, tm.windMph, tm.category, tm.live) } : null}
              smoothRadar={prefs.smoothRadar !== false} onSmoothRadar={(v) => setPrefs((p) => ({ ...p, smoothRadar: v }))}
              homePoint={snap?.home.configured ? { lat: snap.home.lat, lon: snap.home.lon } : null}
              pickingHome={pickingHome} onMapPick={(p) => { setBrowserHome({ name: `Home (${p.lat.toFixed(3)}, ${p.lon.toFixed(3)})`, lat: p.lat, lon: p.lon, source: "browser" }); setPickingHome(false); }}
              onToggle={(k: LayerKey) => { setPrefs((p) => ({ ...p, mode: "standard" })); setLayers((l) => ({ ...l, [k]: !shownLayers[k] })); }} lowBandwidth={prefs.lowBw} />
          </div>
          {more && <div className="center-bottom">
            <SitrepReadout snap={snap} storm={storm} onSpeak={speak} area="sitrep" />
            <HourlyStrip snap={snap} area="hourly" />
          </div>}
        </section>
        {more && <aside className="col right">
          <PowerPanel snap={snap} area="power" areas={outageAreas} now={now} />
          <RiversPanel snap={snap} area="rivers" />
          <TidesPanel snap={snap} area="tides" />
          <BuoysPanel snap={snap} area="buoys" />
          <EventLog snap={snap} area="events" />
          <LinksPanel area="links" office={snap?.forecast?.office ?? null} extra={storm?.publicAdvisoryUrl ? [{ name: `NHC advisory ${storm.advisoryNumber ?? ""}`, url: storm.publicAdvisoryUrl }] : []} />
        </aside>}
      </main>
      <FeedTicker snap={snap} now={now} />
    </div>
  );
}
