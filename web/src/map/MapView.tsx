import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap, Marker, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import type { Hazard, Snapshot, Storm, StormGis } from "../types";
import { fmtClockET, fmtET, staleness } from "../time";
import { addStormLayers, STORM_LAYER_IDS, updateStormLayers, WW_HEX } from "./ConeLayer";
import { RADAR_MAX_FRAMES, showRadarFrame, syncRadarFrames } from "./RadarLayer";
import { LAYER_LABELS, VIEW_LABELS, type LayerKey, type ViewMode } from "./layers";
import { addHazardLayers, HAZARD_LAYER_IDS, updateHazardLayers } from "./HazardLayer";
import { activeAt, CONE_TEXT, FLOOD_KINDS, HAZARD_HEX, HAZARD_NAME, hazardFeatures, TORNADO_KINDS, untilET } from "../hazards";
import { circle } from "../timeline";
import { className, ktToMph } from "../format";
import { needsPan, radarForTime, stormLabel } from "./sliderView";

const OFM_STYLE = "https://tiles.openfreemap.org/styles/dark";
// Offline / low-bandwidth fallback: no basemap tiles at all.
const BARE: StyleSpecification = { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#070909" } }] };
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const pt = (lon: number, lat: number, properties: Record<string, unknown>): GeoJSON.Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });

/** 1° graticule lines + labels over the Gulf / Southeast. */
function graticule(): GeoJSON.FeatureCollection {
  const f: GeoJSON.Feature[] = [];
  for (let lon = -100; lon <= -70; lon++) f.push({ type: "Feature", properties: { major: lon % 5 === 0 }, geometry: { type: "LineString", coordinates: [[lon, 15], [lon, 40]] } });
  for (let lat = 15; lat <= 40; lat++) f.push({ type: "Feature", properties: { major: lat % 5 === 0 }, geometry: { type: "LineString", coordinates: [[-100, lat], [-70, lat]] } });
  for (let lon = -100; lon <= -70; lon++) for (let lat = 15; lat <= 40; lat++)
    if (lon % 2 === 0 && lat % 2 === 0) f.push({ type: "Feature", properties: { label: `${lat}N ${Math.abs(lon)}W` }, geometry: { type: "Point", coordinates: [lon, lat] } });
  return { type: "FeatureCollection", features: f };
}

function yesterdayUtc() { const d = new Date(Date.now() - 36 * 3_600_000); return d.toISOString().slice(0, 10); }

export interface SliderPos { lat: number; lon: number; time: number; label: string; trail: [number, number][]; uncertaintyMi: number; live: boolean }
export interface Landmark { name: string; lat: number; lon: number; kind: string; source?: string }

export default function MapView({ snap, storm, gis, layers, onToggle, lowBandwidth, ghost, hazards = [], hazardTime, mode = "standard", onMode }: {
  ghost?: SliderPos | null; hazards?: Hazard[]; hazardTime: number; mode?: ViewMode; onMode?: (m: ViewMode) => void;
  snap: Snapshot | null; storm: Storm | undefined; gis: StormGis | undefined;
  layers: Record<LayerKey, boolean>; onToggle: (k: LayerKey) => void; lowBandwidth: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const baseLayers = useRef<string[]>([]);
  const markers = useRef<Marker[]>([]);
  const radarIds = useRef<string[]>([]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(!matchMedia("(prefers-reduced-motion: reduce)").matches);
  const fitted = useRef<string | null>(null);

  // Init: fetch the dark style first so an offline start falls back to a bare style instead of a blank map.
  useEffect(() => {
    if (!el.current) return;
    let cancelled = false;
    (async () => {
      let style: StyleSpecification | string = BARE;
      try { const r = await fetch(OFM_STYLE, { signal: AbortSignal.timeout(6000) }); if (r.ok) style = await r.json(); } catch { /* offline */ }
      if (cancelled || !el.current) return;
      const m = new maplibregl.Map({ container: el.current, style, center: [-85.5, 29], zoom: 5, attributionControl: { compact: true } });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => {
        baseLayers.current = (m.getStyle().layers ?? []).map((l) => l.id);
        m.addSource("nightlights", { type: "raster", tileSize: 256, maxzoom: 8,
          tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/${yesterdayUtc()}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
          attribution: "NASA GIBS / VIIRS" });
        m.addLayer({ id: "nightlights", type: "raster", source: "nightlights", layout: { visibility: "none" }, paint: { "raster-opacity": 0.8 } });
        m.addSource("graticule", { type: "geojson", data: graticule() });
        m.addLayer({ id: "grat-line", type: "line", source: "graticule", filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#7fae8c", "line-opacity": ["case", ["get", "major"], 0.22, 0.09], "line-width": 0.6 } });
        m.addLayer({ id: "grat-label", type: "symbol", source: "graticule", filter: ["==", ["geometry-type"], "Point"], minzoom: 5,
          layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 9, "text-anchor": "top-left", "text-offset": [0.3, 0.3] },
          paint: { "text-color": "#5d6b62" } });
        addStormLayers(m);
        addHazardLayers(m);
        m.on("click", "hz-fill", (e) => {
          const ps = (e.features ?? []).map((f) => f.properties as Record<string, any>);
          if (!ps.length) return;
          const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
          const rows = ps.map((p) => { const h = hzRef.current.find((x) => x.id === p.id); return h ? `<b>${esc(h.title)}</b><br>${esc(h.plain)}<br>Until ${untilET(h.expires)} · ${esc(h.issuer)}${h.url && /^https:/.test(h.url) && !/api\.weather\.gov/.test(h.url) ? ` · <a href="${h.url}" target="_blank" rel="noreferrer">details</a>` : ""}<br><small>Source: ${esc(h.source)}</small>` : ""; });
          new maplibregl.Popup({ closeButton: true, className: "hud-popup", maxWidth: "340px" }).setLngLat(e.lngLat).setHTML(rows.join("<hr>")).addTo(m);
        });
        m.on("mouseenter", "hz-fill", () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", "hz-fill", () => (m.getCanvas().style.cursor = ""));
        for (const id of ["tm-trail", "tm-ring", "tm-toa"]) m.addSource(id, { type: "geojson", data: EMPTY });
        m.addLayer({ id: "tm-ring-fill", type: "fill", source: "tm-ring", paint: { "fill-color": "#ff5a4f", "fill-opacity": 0.08 } });
        m.addLayer({ id: "tm-ring-line", type: "line", source: "tm-ring", paint: { "line-color": "#ff5a4f", "line-width": 1, "line-dasharray": [3, 2] } });
        m.addLayer({ id: "tm-toa-line", type: "line", source: "tm-toa", paint: { "line-color": "#e3a64a", "line-width": 2, "line-opacity": 0.9 } });
        m.addLayer({ id: "tm-trail-line", type: "line", source: "tm-trail", paint: { "line-color": "#ff5a4f", "line-width": 3 } });
        // Faint "where the storm is now" dot, shown only when the slider is away from now.
        m.addSource("storm-now", { type: "geojson", data: EMPTY });
        m.addLayer({ id: "storm-now-dot", type: "circle", source: "storm-now", paint: { "circle-radius": 5, "circle-color": "#ff5a4f", "circle-opacity": 0.25, "circle-stroke-color": "#ff5a4f", "circle-stroke-opacity": 0.5, "circle-stroke-width": 1 } });
        m.addLayer({ id: "storm-now-label", type: "symbol", source: "storm-now", layout: { "text-field": "now", "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top" }, paint: { "text-color": "#ff8a80", "text-opacity": 0.7, "text-halo-color": "#070909", "text-halo-width": 1.5 } });
        // Public places from config/landmarks.json (on by default).
        m.addSource("landmarks", { type: "geojson", data: EMPTY });
        m.addLayer({ id: "landmarks-dot", type: "circle", source: "landmarks", paint: { "circle-radius": ["match", ["get", "kind"], "city", 5, 4], "circle-color": "#f2e9c9", "circle-stroke-color": "#070909", "circle-stroke-width": 1.5 } });
        m.addLayer({ id: "landmarks-label", type: "symbol", source: "landmarks", layout: {
          "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": ["match", ["get", "kind"], "city", 15, 13],
          "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.7, "text-allow-overlap": false, "text-optional": true },
          paint: { "text-color": "#f2e9c9", "text-halo-color": "#070909", "text-halo-width": 2 } });
        for (const id of ["outages", "gauges", "buoys"]) m.addSource(id, { type: "geojson", data: EMPTY });
        m.addLayer({ id: "gauges", type: "circle", source: "gauges", paint: {
          "circle-radius": 3.5, "circle-stroke-width": 1, "circle-stroke-color": "#070909",
          "circle-color": ["match", ["get", "trend"], "rising", "#c47f45", "falling", "#7fae8c", "steady", "#8b938d", "#5d6b62"] } });
        m.addLayer({ id: "buoys", type: "circle", source: "buoys", paint: {
          "circle-radius": 3.5, "circle-color": "#070909", "circle-stroke-color": "#c8cfc6", "circle-stroke-width": 1 } });
        m.addLayer({ id: "outages", type: "circle", source: "outages", paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "customers"], 1, 3, 100, 6, 1000, 10], "circle-color": "#d23c34", "circle-opacity": 0.85, "circle-stroke-color": "#070909", "circle-stroke-width": 1 } });
        for (const id of ["outages", "gauges", "buoys", "fcst-pts"]) {
          m.on("click", id, (e) => {
            const p = e.features?.[0]?.properties as Record<string, any> | undefined;
            if (!p) return;
            new maplibregl.Popup({ closeButton: false, className: "hud-popup" }).setLngLat(e.lngLat).setHTML(p.popup ?? `<b>${p.etLabel ?? ""}</b>`).addTo(m);
          });
          m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
        }
        setReady(true);
      });
    })();
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  // Hazard polygons in effect at the slider time (or now when live).
  const hzRef = useRef<Hazard[]>([]);
  hzRef.current = hazards;
  const hzKinds = [...(layers.tornado ? TORNADO_KINDS : []), ...(layers.flood ? FLOOD_KINDS : [])];
  const hzMinute = Math.floor(hazardTime / 60_000);
  useEffect(() => { if (ready && map.current) updateHazardLayers(map.current, hazardFeatures(hazards, hazardTime, hzKinds)); }, [ready, hazards, hzMinute, layers.tornado, layers.flood]);
  const hzShown = activeAt(hazards, hazardTime).filter((h) => hzKinds.includes(h.kind));

  // Storm geometry.
  useEffect(() => { if (ready && map.current) updateStormLayers(map.current, gis); }, [ready, gis]);

  // Point layers: outages, gauges, buoys (+ popups text).
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !snap) return;
    const set = (id: string, d: GeoJSON.FeatureCollection) => (m.getSource(id) as GeoJSONSource | undefined)?.setData(d);
    set("outages", fc((snap.power.local?.outages ?? []).map((o) => pt(o.lon, o.lat, { customers: o.customers,
      popup: `<b>POWER OUTAGE</b><br>${o.customers} customers · ${o.status ?? ""}<br>Cause: ${o.cause ?? "—"}<br>Off: ${fmtET(o.off)}<br>Estimated fix: ${fmtET(o.etr)}${o.etrPassed ? " <b class='red'>(PASSED)</b>" : ""}<br>${o.distanceMi} mi from you` }))));
    set("gauges", fc(snap.gauges.map((g) => pt(g.lon, g.lat, { trend: g.trend,
      popup: `<b>${g.name}</b><br>Stage ${g.stageFt ?? "—"} ft · ${g.trend} (${g.change3hFt ?? "?"} ft / 3 h)<br>USGS ${g.id} · ${fmtET(g.time)}` }))));
    set("buoys", fc(snap.buoys.map((b) => pt(b.lon, b.lat, {
      popup: `<b>NDBC ${b.id}</b> ${b.name}<br>Wind ${ktToMph(b.windKt) ?? "—"} mph, gusts ${ktToMph(b.gustKt) ?? "—"} mph · ${b.pressureMb ?? "—"} mb · seas ${b.waveFt ?? "—"} ft<br>${b.distanceToStormMi} mi from storm · ${fmtET(b.time)}` }))));
  }, [ready, snap]);

  // Markers: home + storms.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !snap) return;
    markers.current.forEach((x) => x.remove());
    const mk = (cls: string, html: string) => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; return d; };
    markers.current = [
      ...(!snap.home.configured ? [] : [new Marker({ element: mk("pin-home", `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="9" /><line x1="20" y1="0" x2="20" y2="13" /><line x1="20" y1="27" x2="20" y2="40" /><line x1="0" y1="20" x2="13" y2="20" /><line x1="27" y1="20" x2="40" y2="20" /></svg><span class="pin-label">HOME</span>`) }).setLngLat([snap.home.lon, snap.home.lat]).addTo(m)]),
      // Other (not selected) storms only. The selected storm has exactly one icon: the slider-time marker below.
      ...snap.storms.filter((s) => s.id !== storm?.id).map((s) => new Marker({ element: mk("pin-storm pin-other",
        `<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="6" /><line x1="12" y1="0" x2="12" y2="24" /><line x1="0" y1="12" x2="24" y2="12" /></svg><span class="pin-label">${s.name} now · ${s.category} · ${ktToMph(s.intensityKt) ?? "?"} mph</span>`) }).setLngLat([s.lon, s.lat]).addTo(m)),
    ];
  }, [ready, snap?.home.lat, snap?.home.lon, snap?.storms, storm?.id]);

  // Forecast-time marker (time slider). This is the main storm marker: it sits where the NHC
  // forecast puts the storm at the slider time, with a trail from now to that time, an
  // uncertainty ring (typical NHC cone size at that lead time) and tropical-storm wind arrival lines up to that time.
  const ghostMk = useRef<Marker | null>(null);
  // Fallback when no NHC track is loaded yet: the one storm icon sits at the latest observed position.
  const main: SliderPos | null = ghost ?? (storm ? { lat: storm.lat, lon: storm.lon, time: Date.parse(storm.lastUpdate ?? "") || Date.now(), trail: [], uncertaintyMi: 0, live: true,
    label: stormLabel(storm.name, Date.parse(storm.lastUpdate ?? "") || Date.now(), ktToMph(storm.intensityKt), storm.category, true) } : null);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const ghost = main;
    const src = (id: string) => m.getSource(id) as GeoJSONSource | undefined;
    if (!ghost) {
      ghostMk.current?.remove(); ghostMk.current = null;
      for (const id of ["tm-trail", "tm-ring", "tm-toa"]) src(id)?.setData(EMPTY);
      return;
    }
    if (!ghostMk.current) {
      const d = document.createElement("div"); d.className = "pin-slider pin-storm-main"; d.dataset.testid = "storm-marker";
      d.innerHTML = `<svg viewBox="0 0 34 34" width="34" height="34"><circle cx="17" cy="17" r="11" /><circle cx="17" cy="17" r="3" /><line x1="17" y1="0" x2="17" y2="6" /><line x1="17" y1="28" x2="17" y2="34" /><line x1="0" y1="17" x2="6" y2="17" /><line x1="28" y1="17" x2="34" y2="17" /></svg><span class="pin-label"></span>`;
      ghostMk.current = new Marker({ element: d }).setLngLat([ghost.lon, ghost.lat]).addTo(m);
    }
    ghostMk.current.setLngLat([ghost.lon, ghost.lat]);
    const lbl = ghostMk.current.getElement().querySelector(".pin-label"); if (lbl) lbl.textContent = ghost.label;
    src("tm-trail")?.setData(fc(ghost.trail.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ghost.trail } }] : []));
    src("tm-ring")?.setData(fc(ghost.uncertaintyMi > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle(ghost.lon, ghost.lat, ghost.uncertaintyMi)] } }] : []));
    const toa = (gis?.toaMostLikely?.features ?? []).filter((f) => Date.parse(String((f.properties as any)?.time)) <= ghost.time);
    src("tm-toa")?.setData(fc(toa));
    // Debug hook for headless checks (WebGL may not paint there): last position the map was given.
    (window as any).__sliderMarker = { lng: ghostMk.current.getLngLat().lng, lat: ghostMk.current.getLngLat().lat, time: ghost.time, trailPoints: ghost.trail.length, live: ghost.live,
      stormIcons: document.querySelectorAll(".pin-storm-main").length };
    // Faint "now" dot only when looking at another time.
    src("storm-now")?.setData(fc(!ghost.live && storm ? [pt(storm.lon, storm.lat, {})] : []));
    // Keep the storm in view: pan only once it leaves the central 70% of the map (no jitter while dragging).
    const c = m.getContainer(), p = m.project([ghost.lon, ghost.lat]);
    if (needsPan(p.x, p.y, c.clientWidth, c.clientHeight, 0.7)) m.easeTo({ center: [ghost.lon, ghost.lat], duration: 300 });
  }, [ready, main?.lat, main?.lon, main?.label, main?.uncertaintyMi, main?.live, storm?.lat, storm?.lon, gis]);
  useEffect(() => () => { ghostMk.current?.remove(); ghostMk.current = null; }, []);

  // Landmarks (public places) from config/landmarks.json.
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  useEffect(() => { fetch("/api/landmarks").then((r) => r.json()).then((d) => setLandmarks(Array.isArray(d.landmarks) ? d.landmarks : [])).catch(() => {}); }, []);
  useEffect(() => {
    if (ready && map.current) (map.current.getSource("landmarks") as GeoJSONSource | undefined)?.setData(fc(landmarks.map((l) => pt(l.lon, l.lat, { name: l.name, kind: l.kind }))));
  }, [ready, landmarks]);

  // Fit to home + storm + cone once per selected storm.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !snap || !storm || fitted.current === storm.id) return;
    fitted.current = storm.id;
    const b = new maplibregl.LngLatBounds([storm.lon, storm.lat], [storm.lon, storm.lat]);
    if (snap.home.configured) b.extend([snap.home.lon, snap.home.lat]);
    const pts = gis?.forecastPoints?.features.slice(0, 3) ?? [];
    pts.forEach((f) => b.extend((f.geometry as GeoJSON.Point).coordinates as [number, number]));
    m.fitBounds(b, { padding: { top: 70, bottom: 70, left: 60, right: 60 }, maxZoom: 6.5, duration: 0 });
  }, [ready, storm?.id, gis]);

  // Layer visibility + low-bandwidth basemap switch.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    for (const [k, ids] of Object.entries(STORM_LAYER_IDS)) ids.forEach((id) => vis(id, layers[k as LayerKey]));
    vis("outages", layers.outages);
    HAZARD_LAYER_IDS.forEach((id) => vis(id, layers.tornado || layers.flood));
    vis("gauges", layers.gauges); vis("buoys", layers.buoys);
    vis("landmarks-dot", layers.landmarks); vis("landmarks-label", layers.landmarks);
    vis("nightlights", layers.nightlights && !lowBandwidth);
    baseLayers.current.forEach((id) => { if (id !== "bg" && !/background/.test(id)) vis(id, !lowBandwidth); });
  }, [ready, layers, lowBandwidth]);

  // Radar frames.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    radarIds.current = syncRadarFrames(m, snap?.radar ?? null, layers.radar && !lowBandwidth);
    setFrame(radarIds.current.length - 1);
  }, [ready, snap?.radar, layers.radar, lowBandwidth]);
  // Radar follows the slider: live = animated loop; past = the closest observed frame; future = no radar.
  const frames = snap?.radar?.frames.slice(-RADAR_MAX_FRAMES) ?? [];
  const radarPick = radarForTime(frames, main?.time ?? Date.now(), Date.now(), main?.live ?? true);
  const radarLive = radarPick.mode === "live";
  useEffect(() => {
    if (!playing || !radarLive || radarIds.current.length < 2) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % radarIds.current.length), 700);
    return () => clearInterval(t);
  }, [playing, radarLive, ready, snap?.radar]);
  const shownFrame = radarLive ? frame : radarPick.index;
  useEffect(() => { if (map.current && ready) showRadarFrame(map.current, radarIds.current, shownFrame); }, [shownFrame, ready, snap?.radar, layers.radar]);
  (window as any).__radar = { mode: radarPick.mode, index: shownFrame, frameTime: shownFrame >= 0 ? frames[shownFrame]?.time ?? null : null };

  const fTime = shownFrame >= 0 ? frames[shownFrame]?.time ?? null : null;
  const f = snap?.feeds ?? {};
  const st = (k: string) => (f[k] ? staleness(f[k].lastSuccess, f[k].pollSeconds) : "red");

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div className="map-chips">
        {onMode && (Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
          <button key={v} className={`btn mode ${mode === v ? "on" : ""}`} onClick={() => onMode(v)} aria-pressed={mode === v}>{VIEW_LABELS[v]}</button>
        ))}
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
          <button key={k} className={`btn ${layers[k] ? "on" : ""}`} onClick={() => onToggle(k)}>{LAYER_LABELS[k]}</button>
        ))}
        {snap?.home.configured && <button className="btn" onClick={() => { fitted.current = null; map.current?.flyTo({ center: [snap.home.lon, snap.home.lat], zoom: 6 }); }}>center home</button>}
      </div>
      {layers.radar && !lowBandwidth && frames.length > 0 && (
        <div className="radar-ctl">
          {radarLive && <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? "pause" : "play"}</button>}
          <span data-testid="radar-note">{radarLive ? <>Radar image from {fmtClockET(fTime)} ET (latest loop)</> : radarPick.note}</span>
          {shownFrame >= 0 && <div className="frame-dots">{frames.map((_, i) => <i key={i} className={i === shownFrame ? "on" : ""} />)}</div>}
        </div>
      )}
      {main && <div className="map-time" data-testid="map-time">Map shows: {new Date(main.time).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET{main.live ? " (live)" : main.time > Date.now() ? " (forecast)" : " (past)"}</div>}
      <div className="map-legend">
        {ghost && <div><span style={{ color: "#ff5a4f" }}>━</span> Path from now to the selected time · <span style={{ color: "#ff5a4f" }}>◌</span> Likely error range at that time · <span style={{ color: "#e3a64a" }}>━</span> Where tropical-storm winds have likely arrived by then</div>}
        <div className={`stale-${st("nhcgis")}`}>{storm ? `${className(storm.classification)} ${storm.name}` : "No storm"} · NHC advisory {gis?.advisoryNumber ?? "—"} · {fmtET(gis?.issuance)}</div>
        {layers.cone && <div className="cone-note">{CONE_TEXT}</div>}
        {(layers.tornado || layers.flood) && <div className={`stale-${st("hazards")}`}>
          Watches and warnings in effect {ghost && Math.abs(hazardTime - Date.now()) > 120_000 ? "at the selected time" : "now"}: {hzShown.length ? hzShown.length : "none on the map"} · Sources: NOAA Storm Prediction Center (watches, via Iowa Environmental Mesonet) and National Weather Service · updated {fmtET(f.hazards?.lastSuccess)}{st("hazards") !== "fresh" ? " · OUT OF DATE" : ""}
          {hazardTime > Date.now() + 120_000 && <><br />Future times only show watches and warnings already issued. New ones can be issued at any time.</>}
        </div>}
        {(layers.tornado || layers.flood) && <div className="ww-key">
          {[...(layers.tornado ? TORNADO_KINDS : []), ...(layers.flood ? FLOOD_KINDS : [])].map((k) => <span key={k}><i style={{ background: HAZARD_HEX[k] }} />{HAZARD_NAME[k]} </span>)}
        </div>}
        {mode !== "hazards" && <div className={`stale-${st("radar")}`}>Radar (RainViewer) · latest {fmtET(snap?.radar?.frames.at(-1)?.time)}</div>}
        {snap?.power.local && <div className={`stale-${st("power")}`}>{snap.power.local.name}: {snap.power.local.count} · as of {fmtET(f.power?.sourceTime)}</div>}
        {snap?.home.configured && <div className={`stale-${st("usgs")}`}>River gauges (USGS) · {fmtET(f.usgs?.sourceTime)} <span className="lg-dot r" />rising <span className="lg-dot s" />steady</div>}
        <div className={`stale-${st("ndbc")}`}>Buoys near the storm (NOAA) · {fmtET(f.ndbc?.sourceTime)}</div>
        <div className="ww-key"><i style={{ background: WW_HEX.HWR }} />Hurricane warning <i style={{ background: WW_HEX.HWA }} />Hurricane watch <i style={{ background: WW_HEX.TWR }} />Tropical storm warning <i style={{ background: WW_HEX.TWA }} />Tropical storm watch</div>
        {layers.nightlights && <div>NASA night lights satellite ({yesterdayUtc()}, clouds block it; post-storm use)</div>}
      </div>
    </div>
  );
}
