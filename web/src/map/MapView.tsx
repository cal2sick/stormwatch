import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap, Marker, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import type { Hazard, Snapshot, Storm, StormGis } from "../types";
import { fmtClockET, fmtET, staleness } from "../time";
import { addStormLayers, STORM_LAYER_IDS, updateStormLayers, WW_HEX } from "./ConeLayer";
import { RadarPool, type RadarLoadState } from "./RadarLayer";
import { LAYER_LABELS, VIEW_LABELS, type LayerKey, type ViewMode } from "./layers";
import { addHazardLayers, HAZARD_LAYER_IDS, updateHazardLayers } from "./HazardLayer";
import { activeAt, CONE_TEXT, FLOOD_KINDS, HAZARD_HEX, HAZARD_NAME, hazardFeatures, TORNADO_KINDS, untilET } from "../hazards";
import { circle } from "../timeline";
import { className, ktToMph } from "../format";
import { goesTimeAt, hrrrRadarUrl, iemRadarUrl, needsPan, phaseAt, radarForTime, radarViewAt, stormLabel, type Phase } from "./sliderView";
import { quadRing, type RadiiState } from "../stormTime";
import { fmtPct, OUTAGE_FILL_EXPR, type OutageAreas } from "../outages";
import { OutageRamp } from "../hud/OutageSummary";

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

const GOES_URL = (time: string) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/${time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
function yesterdayUtc() { const d = new Date(Date.now() - 36 * 3_600_000); return d.toISOString().slice(0, 10); }

export interface SliderPos { lat: number; lon: number; time: number; label: string; trail: [number, number][]; uncertaintyMi: number; live: boolean; radii?: RadiiState }
export interface Landmark { name: string; lat: number; lon: number; kind: string; source?: string }

export default function MapView({ onJump, snap, storm, gis, layers, onToggle, lowBandwidth, ghost, hazards = [], hazardTime, mode = "standard", onMode, place = null, placeOutages = [], evacZones = null, outageAreas = null }: {
  outageAreas?: OutageAreas | null;
  evacZones?: GeoJSON.FeatureCollection | null; onJump?: (t: number | null) => void;
  place?: { name: string; lat: number; lon: number } | null; placeOutages?: { lat: number; lon: number; customers: number; cause: string | null; etr: string | null; source: string; distanceMi: number }[];
  ghost?: SliderPos | null; hazards?: Hazard[]; hazardTime: number; mode?: ViewMode; onMode?: (m: ViewMode) => void;
  snap: Snapshot | null; storm: Storm | undefined; gis: StormGis | undefined;
  layers: Record<LayerKey, boolean>; onToggle: (k: LayerKey) => void; lowBandwidth: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const baseLayers = useRef<string[]>([]);
  const markers = useRef<Marker[]>([]);
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
      (window as any).__map = m; // debug hook for headless checks
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => {
        baseLayers.current = (m.getStyle().layers ?? []).map((l) => l.id);
        m.addSource("nightlights", { type: "raster", tileSize: 256, maxzoom: 8,
          tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/${yesterdayUtc()}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
          attribution: "NASA GIBS / VIIRS" });
        m.addLayer({ id: "nightlights", type: "raster", source: "nightlights", layout: { visibility: "none" }, paint: { "raster-opacity": 0.8 } });
        // GOES-19 (GOES-East) clean infrared, time-matched to the slider (NASA GIBS, keyless).
        m.addSource("goes", { type: "raster", tileSize: 256, maxzoom: 6, tiles: [GOES_URL(goesTimeAt(Date.now(), Date.now()).time)], attribution: "GOES-19 imagery: NOAA / NASA GIBS" });
        m.addLayer({ id: "goes", type: "raster", source: "goes", layout: { visibility: "none" }, paint: { "raster-opacity": 0.7, "raster-fade-duration": 0 } });
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
        for (const id of ["tm-trail", "tm-ring", "tm-toa", "tm-wind"]) m.addSource(id, { type: "geojson", data: EMPTY });
        // Wind field at the slider time: NHC 34 / 50 / 64-knot radii by quadrant, interpolated in time.
        m.addLayer({ id: "tm-wind-fill", type: "fill", source: "tm-wind", paint: { "fill-color": ["match", ["get", "kt"], 64, "#d6336c", 50, "#f08c00", "#ffd43b"], "fill-opacity": 0.16 } });
        m.addLayer({ id: "tm-wind-line", type: "line", source: "tm-wind", paint: { "line-color": ["match", ["get", "kt"], 64, "#d6336c", 50, "#f08c00", "#ffd43b"], "line-width": 1.2, "line-opacity": 0.8 } });
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
        // Florida evacuation zones (FDEM) for the searched place's county. Zone A = first to evacuate.
        m.addSource("evac", { type: "geojson", data: EMPTY });
        m.addLayer({ id: "evac-fill", type: "fill", source: "evac", paint: { "fill-color": ["match", ["get", "EZone"], "A", "#e03131", "B", "#f76707", "C", "#fab005", "D", "#74b816", "E", "#1c7ed6", "#7048e8"], "fill-opacity": 0.22 } });
        m.addLayer({ id: "evac-line", type: "line", source: "evac", paint: { "line-color": "#f2e9c9", "line-width": 0.6, "line-opacity": 0.6 } });
        m.addLayer({ id: "evac-label", type: "symbol", source: "evac", minzoom: 8, layout: { "text-field": ["concat", "Zone ", ["get", "EZone"]], "text-font": ["Noto Sans Regular"], "text-size": 11 }, paint: { "text-color": "#f2e9c9", "text-halo-color": "#070909", "text-halo-width": 1.5 } });
        // v0.6 outage areas: one % ramp (0/10/30/60/100). Counties (ORNL ODIN) and City of Tallahassee Utilities regions.
        for (const id of ["out-counties", "out-regions"]) {
          m.addSource(id, { type: "geojson", data: EMPTY });
          m.addLayer({ id: `${id}-fill`, type: "fill", source: id, paint: { "fill-color": OUTAGE_FILL_EXPR, "fill-opacity": 0.35 } });
          m.addLayer({ id: `${id}-line`, type: "line", source: id, paint: { "line-color": id === "out-regions" ? "#ffe066" : "#c8cfc6", "line-width": 1, "line-opacity": 0.7,
            ...(id === "out-counties" ? { "line-dasharray": [2, 2] } : {}) } });
          m.addLayer({ id: `${id}-label`, type: "symbol", source: id, minzoom: id === "out-regions" ? 9 : 6.5, layout: { "text-field": ["concat", ["get", "name"], "\n", ["to-string", ["get", "out"]], " out"],
            "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": false }, paint: { "text-color": "#ffe9a8", "text-halo-color": "#070909", "text-halo-width": 1.5 } });
        }
        // Outage points, clustered (circle size = customers out; the number = customers in the cluster).
        m.addSource("place-outages", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 42, clusterMaxZoom: 13, clusterProperties: { customers: ["+", ["get", "customers"]] } });
        m.addLayer({ id: "po-cluster", type: "circle", source: "place-outages", filter: ["has", "point_count"], paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "customers"], 1, 10, 100, 15, 1000, 22, 10000, 30], "circle-color": "#ffb020", "circle-opacity": 0.75, "circle-stroke-color": "#070909", "circle-stroke-width": 1.5 } });
        m.addLayer({ id: "po-cluster-n", type: "symbol", source: "place-outages", filter: ["has", "point_count"], layout: { "text-field": ["to-string", ["get", "customers"]], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-allow-overlap": true },
          paint: { "text-color": "#070909" } });
        m.addLayer({ id: "place-outages", type: "circle", source: "place-outages", filter: ["!", ["has", "point_count"]], paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "customers"], 1, 4, 100, 7, 1000, 12], "circle-color": "#ffb020", "circle-opacity": 0.85, "circle-stroke-color": "#070909", "circle-stroke-width": 1 } });
        m.on("click", "po-cluster", async (e) => {
          const f = e.features?.[0]; if (!f) return;
          const src = m.getSource("place-outages") as GeoJSONSource;
          try { const z = await src.getClusterExpansionZoom((f.properties as any).cluster_id); m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z }); } catch { /* ignore */ }
        });
        for (const id of ["out-regions-fill", "out-counties-fill"]) {
          m.on("click", id, (e) => {
            const p = e.features?.[0]?.properties as Record<string, any> | undefined; if (!p) return;
            new maplibregl.Popup({ closeButton: true, className: "hud-popup", maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(p.popup ?? "").addTo(m);
          });
        }
        for (const id of ["outages", "gauges", "buoys", "tides", "cameras"]) m.addSource(id, { type: "geojson", data: EMPTY });
        m.addLayer({ id: "cameras", type: "circle", source: "cameras", paint: { "circle-radius": 5, "circle-color": "#f2e9c9", "circle-stroke-color": "#3b5bdb", "circle-stroke-width": 2 } });
        m.addLayer({ id: "tides", type: "circle", source: "tides", paint: { "circle-radius": 5, "circle-color": ["step", ["get", "above"], "#4dabf7", 1, "#f08c00", 2, "#e03131"], "circle-stroke-color": "#070909", "circle-stroke-width": 1.5 } });
        m.addLayer({ id: "gauges", type: "circle", source: "gauges", paint: {
          "circle-radius": 3.5, "circle-stroke-width": 1, "circle-stroke-color": "#070909",
          "circle-color": ["match", ["get", "trend"], "rising", "#c47f45", "falling", "#7fae8c", "steady", "#8b938d", "#5d6b62"] } });
        m.addLayer({ id: "buoys", type: "circle", source: "buoys", paint: {
          "circle-radius": 3.5, "circle-color": "#070909", "circle-stroke-color": "#c8cfc6", "circle-stroke-width": 1 } });
        m.addLayer({ id: "outages", type: "circle", source: "outages", paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "customers"], 1, 3, 100, 6, 1000, 10], "circle-color": "#d23c34", "circle-opacity": 0.85, "circle-stroke-color": "#070909", "circle-stroke-width": 1 } });
        for (const id of ["outages", "gauges", "buoys", "tides", "cameras", "fcst-pts", "place-outages", "po-cluster"]) {
          m.on("click", id, (e) => {
            const p = e.features?.[0]?.properties as Record<string, any> | undefined;
            if (!p) return;
            new maplibregl.Popup({ closeButton: false, className: "hud-popup", maxWidth: "340px" }).setLngLat(e.lngLat).setHTML(p.popup ?? `<b>${p.etLabel ?? ""}</b>`).addTo(m);
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
    set("tides", fc((snap.tides ?? []).filter((x) => isFinite(x.lat) && isFinite(x.lon)).map((x) => pt(x.lon, x.lat, { above: x.aboveForecastFt ?? 0,
      popup: `<b>${x.name}</b> (NOAA tide gauge ${x.id})<br>Water ${x.levelFtMhhw} ft vs normal high tide · ${x.aboveForecastFt ?? "—"} ft vs predicted tide<br>${fmtET(x.time)}` }))));
    const escH = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const httpsOnly = (u: string | null) => (u && /^https:\/\//.test(u) ? escH(u) : "");
    set("cameras", fc((snap.cameras ?? []).map((c) => pt(c.lon, c.lat, {
      popup: `<b>${escH(c.name)}</b><br><a href="${httpsOnly(c.pageUrl)}" target="_blank" rel="noreferrer"><img src="${httpsOnly(c.imageUrl)}" alt="Latest camera image" style="width:300px;max-width:100%;display:block;margin:4px 0" loading="lazy"></a>Latest image ${fmtET(c.time)} · ${escH(c.source)}` }))));
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
  const lastPanT = useRef<number | null>(null);
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
      for (const id of ["tm-trail", "tm-ring", "tm-toa", "tm-wind"]) src(id)?.setData(EMPTY);
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
    const rd = ghost.radii;
    src("tm-wind")?.setData(fc(!rd ? [] : ([[34, rd.r34], [50, rd.r50], [64, rd.r64]] as const).filter(([, q]) => q).map(([kt, q]) =>
      ({ type: "Feature", properties: { kt }, geometry: { type: "Polygon", coordinates: [quadRing(ghost.lon, ghost.lat, q!)] } }) as GeoJSON.Feature)));
    const toa = (gis?.toaMostLikely?.features ?? []).filter((f) => Date.parse(String((f.properties as any)?.time)) <= ghost.time);
    src("tm-toa")?.setData(fc(toa));
    // Debug hook for headless checks (WebGL may not paint there): last position the map was given.
    (window as any).__sliderMarker = { lng: ghostMk.current.getLngLat().lng, lat: ghostMk.current.getLngLat().lat, time: ghost.time, trailPoints: ghost.trail.length, live: ghost.live,
      windAreas: [rd?.r34, rd?.r50, rd?.r64].filter(Boolean).length, coneMi: Math.round(ghost.uncertaintyMi),
      stormIcons: document.querySelectorAll(".pin-storm-main").length };
    // Faint "now" dot only when looking at another time.
    src("storm-now")?.setData(fc(!ghost.live && storm ? [pt(storm.lon, storm.lat, {})] : []));
    // Keep the storm in view: pan only once it leaves the central 70% of the map (no jitter while dragging).
    // Only when the user moved the slider (not on the once-a-second live tick), so it never fights a manual pan or a place search.
    const moved = lastPanT.current != null && Math.abs(ghost.time - lastPanT.current) > 30_000;
    lastPanT.current = ghost.time;
    const c = m.getContainer(), p = m.project([ghost.lon, ghost.lat]);
    if (moved && needsPan(p.x, p.y, c.clientWidth, c.clientHeight, 0.7)) m.easeTo({ center: [ghost.lon, ghost.lat], duration: 300 });
  }, [ready, main?.lat, main?.lon, main?.label, main?.uncertaintyMi, main?.live, main?.radii, storm?.lat, storm?.lon, gis]);
  useEffect(() => () => { ghostMk.current?.remove(); ghostMk.current = null; }, []);

  // Selected location (browser-only): pin + fly there once per new place; nearby outage points.
  const placeMk = useRef<Marker | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    placeMk.current?.remove(); placeMk.current = null;
    if (!place) return;
    const d = document.createElement("div"); d.className = "pin-place"; d.dataset.testid = "place-pin";
    d.innerHTML = `<svg viewBox="0 0 20 28" width="20" height="28"><path d="M10 1C5 1 1 5 1 10c0 7 9 17 9 17s9-10 9-17c0-5-4-9-9-9z"/><circle cx="10" cy="10" r="3" fill="#070909"/></svg><span class="pin-label"></span>`;
    d.querySelector(".pin-label")!.textContent = place.name.split(",")[0];
    placeMk.current = new Marker({ element: d, anchor: "bottom" }).setLngLat([place.lon, place.lat]).addTo(m);
    m.flyTo({ center: [place.lon, place.lat], zoom: Math.max(m.getZoom(), 8), duration: 900 });
    (window as any).__place = { lat: place.lat, lon: place.lon };
  }, [ready, place?.lat, place?.lon]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    // Every point from the free live feeds (whole service area), else the ones near the selected place.
    const all = outageAreas?.points?.length ? outageAreas.points.map((o) => ({ ...o, distanceMi: null as number | null })) : placeOutages;
    (map.current.getSource("place-outages") as GeoJSONSource | undefined)?.setData(fc(all.map((o) => pt(o.lon, o.lat, { customers: o.customers,
      popup: `<b>Power outage</b><br>${o.customers} customer${o.customers === 1 ? "" : "s"} out${o.distanceMi != null ? ` · ${o.distanceMi} miles from the selected place` : ""}<br>Cause: ${esc(o.cause ?? "unknown")}<br>Estimated fix: ${fmtET(o.etr)}${o.etr && Date.parse(o.etr) < Date.now() ? " (time passed)" : ""}<br><small>${esc(o.source)}</small>` }))));
    const popup = (title: string, p: any, extra: string) => `<b>${esc(title)}</b><br>${Number(p.out).toLocaleString()} customers out${p.pct != null ? ` · ${fmtPct(p.pct)}` : ""}<br>${extra}`;
    (map.current.getSource("out-regions") as GeoJSONSource | undefined)?.setData(fc((outageAreas?.regions?.features ?? []).map((f) => ({ ...f,
      properties: { ...f.properties, popup: popup(`City of Tallahassee Utilities, region ${(f.properties as any).name}`, f.properties, `${(f.properties as any).outages} outages · % = share of all the utility's customers (EIA-861)<br><small>City of Tallahassee Utilities outage map</small>`) } }))));
    (map.current.getSource("out-counties") as GeoJSONSource | undefined)?.setData(fc((outageAreas?.counties?.features ?? []).map((f) => {
      const u = (() => { try { return JSON.parse((f.properties as any).utilities ?? "[]"); } catch { return []; } })() as { name: string; out: number; utilityCustomers: number | null }[];
      return { ...f, properties: { ...f.properties, popup: popup((f.properties as any).name, f.properties, `${u.map((x) => `${esc(x.name)}: ${x.out.toLocaleString()}${x.utilityCustomers ? ` (utility has ${x.utilityCustomers.toLocaleString()} customers, EIA-861)` : ""}`).join("<br>")}<br><small>ORNL ODIN, utilities that report to it only${(f.properties as any).pct == null ? "; no county customer total, so not shaded" : ""}</small>`) } };
    })));
    (window as any).__outages = { regions: outageAreas?.regions?.features.length ?? 0, counties: outageAreas?.counties?.features.length ?? 0, points: all.length };
  }, [ready, placeOutages, outageAreas]);

  useEffect(() => { if (ready && map.current) (map.current.getSource("evac") as GeoJSONSource | undefined)?.setData(evacZones ?? EMPTY); }, [ready, evacZones]);

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
    vis("outages", layers.outages); ["place-outages", "po-cluster", "po-cluster-n", "out-regions-fill", "out-regions-line", "out-regions-label", "out-counties-fill", "out-counties-line", "out-counties-label"].forEach((id) => vis(id, layers.outages));
    HAZARD_LAYER_IDS.forEach((id) => vis(id, layers.tornado || layers.flood));
    vis("gauges", layers.gauges); vis("buoys", layers.buoys); vis("tides", layers.buoys); vis("cameras", layers.cameras);
    vis("landmarks-dot", layers.landmarks); vis("landmarks-label", layers.landmarks);
    vis("nightlights", layers.nightlights && !lowBandwidth);
    vis("goes", layers.satellite && !lowBandwidth);
    baseLayers.current.forEach((id) => { if (id !== "bg" && !/background/.test(id)) vis(id, !lowBandwidth); });
  }, [ready, layers, lowBandwidth]);

  // Radar (v0.5): one view rule for live / past / forecast, shown through a preloading crossfade pool.
  const radarOn = layers.radar && !lowBandwidth;
  const tNow = Date.now();
  const sliderT = main?.time ?? tNow;
  const isLive = main?.live ?? true;
  const frames = snap?.radar?.frames ?? [];
  const rv = snap?.radar?.kind === "rainviewer";
  const frameUrl = (f: { path: string }) => rv ? `${snap!.radar!.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png` : iemRadarUrl(f.path);
  const latestScan = frames.at(-1)?.time ?? null;
  const fcRadar = snap?.forecastRadar ?? null;
  const phase = phaseAt(sliderT, tNow, isLive);
  let view = radarViewAt(sliderT, tNow, isLive, latestScan, fcRadar);
  if (rv && view.kind === "observed") { // RainViewer backup has no archive: nearest loop frame only
    const p = radarForTime(frames, sliderT, tNow, isLive, false);
    const fr = p.mode === "live" ? frames.at(-1) : p.index >= 0 ? frames[p.index] : undefined;
    view = fr ? { ...view, url: frameUrl(fr), frameTime: fr.time } : { kind: "none", reason: "no-radar", label: p.note ?? "No radar for this time." };
  }
  // "Radar: last 2 hours" loop (observed), or the forecast steps when the slider is in the forecast.
  const loopFrames = phase === "forecast"
    ? (fcRadar?.steps ?? []).map((s) => ({ url: hrrrRadarUrl(s.initTime, s.fMinute), time: s.validTime, forecast: true }))
    : frames.map((f) => ({ url: frameUrl(f), time: f.time, forecast: false }));
  const goes = goesTimeAt(sliderT, tNow);
  useEffect(() => {
    const src = map.current?.getSource("goes") as unknown as { setTiles?: (t: string[]) => void } | undefined;
    if (ready && layers.satellite && src?.setTiles) src.setTiles([GOES_URL(goes.time)]);
  }, [ready, goes.time, layers.satellite]);
  const poolRef = useRef<RadarPool | null>(null);
  const [loopIdx, setLoopIdx] = useState<number | null>(null);
  const looping = loopIdx != null && loopFrames.length > 1;
  useEffect(() => { setLoopIdx(null); }, [phase]);
  useEffect(() => {
    if (loopIdx == null) return;
    const pool = poolRef.current; if (!pool) return;
    pool.preload(loopFrames.map((f) => f.url));
    const t = setInterval(() => setLoopIdx((i) => {
      if (i == null) return i;
      for (let k = 1; k <= loopFrames.length; k++) { const j = (i + k) % loopFrames.length; if (pool.loaded(loopFrames[j].url)) return j; }
      return i;
    }), 800);
    return () => clearInterval(t);
  }, [loopIdx != null, loopFrames.length, loopFrames[0]?.url]);
  const loopFrame = looping ? loopFrames[loopIdx!] : null;
  const wantUrl = !radarOn ? null : loopFrame ? loopFrame.url : view.kind === "none" ? null : view.url;
  const [radarState, setRadarState] = useState<{ s: RadarLoadState; url: string | null }>({ s: "idle", url: null });
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    if (!poolRef.current) poolRef.current = new RadarPool(m, (s, url) => setRadarState({ s, url }));
    poolRef.current.show(wantUrl);
  }, [ready, wantUrl]);
  // Warm the cache for the 2-hour loop and the forecast steps once the first frame is up, so scrubbing is quick.
  useEffect(() => {
    if (!ready || !radarOn || radarState.s !== "ready" || !poolRef.current) return;
    const t = setTimeout(() => poolRef.current?.preload([...frames.slice(-6).map(frameUrl), ...(fcRadar?.steps ?? []).map((s) => hrrrRadarUrl(s.initTime, s.fMinute))]), 1500);
    return () => clearTimeout(t);
  }, [ready, radarOn, radarState.s === "ready", latestScan, fcRadar?.initTime]);
  const radarLoading = radarOn && wantUrl != null && radarState.url !== wantUrl;
  const shownLabel = loopFrame
    ? `${loopFrame.forecast ? "Playing FORECAST radar" : "Replaying the last 2 hours"} · ${loopFrame.forecast ? "for " : "radar at "}${fmtClockET(loopFrame.time)} ET`
    : view.label;
  (window as any).__radar = { kind: view.kind, phase, url: wantUrl, shownUrl: radarState.url, state: radarState.s, frameTime: view.kind === "none" ? null : view.frameTime, label: shownLabel };
  // Map key: collapsed by default so it never covers the map; the choice is remembered on this device.
  const [keyOpen, setKeyOpenState] = useState<boolean>(() => { try { return localStorage.getItem("sw-mapkey") === "open"; } catch { return false; } });
  const setKeyOpen = (v: boolean) => { setKeyOpenState(v); try { localStorage.setItem("sw-mapkey", v ? "open" : "closed"); } catch { /* private mode */ } };
  const f = snap?.feeds ?? {};
  const st = (k: string) => (f[k] ? staleness(f[k].lastSuccess, f[k].pollSeconds) : "red");

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div className="map-top">
      {onJump && <div className="phase-bar" role="group" aria-label="Choose live, past or forecast" data-testid="phase-bar">
        <button className={`phase live ${phase === "live" ? "on" : ""}`} aria-pressed={phase === "live"} onClick={() => onJump(null)}><i className="dot" />Live now</button>
        <button className={`phase past ${phase === "past" ? "on" : ""}`} aria-pressed={phase === "past"} onClick={() => onJump(phase === "past" ? sliderT : Math.round((tNow - 3.6e6) / 300_000) * 300_000)}>Past</button>
        <button className={`phase fc ${phase === "forecast" ? "on" : ""}`} aria-pressed={phase === "forecast"} onClick={() => onJump(phase === "forecast" ? sliderT : tNow + 60 * 60_000)}>Next 3 hours (forecast)</button>
        {phase === "past" && [-120, -60, -30, -10].map((m) => <button key={m} className="btn tick" onClick={() => onJump(Math.round((tNow + m * 60_000) / 300_000) * 300_000)}>{m} min</button>)}
        {phase === "forecast" && [30, 60, 90, 120, 180].map((m) => <button key={m} className={`btn tick ${Math.abs(sliderT - tNow - m * 60_000) < 8 * 60_000 ? "on" : ""}`} onClick={() => onJump(tNow + m * 60_000)}>+{m} min</button>)}
      </div>}
      <div className="map-chips">
        {onMode && (Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
          <button key={v} className={`btn mode ${mode === v ? "on" : ""}`} onClick={() => onMode(v)} aria-pressed={mode === v}>{VIEW_LABELS[v]}</button>
        ))}
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
          <button key={k} className={`btn ${layers[k] ? "on" : ""}`} onClick={() => onToggle(k)}>{LAYER_LABELS[k]}</button>
        ))}
        {snap?.home.configured && <button className="btn" onClick={() => { fitted.current = null; map.current?.flyTo({ center: [snap.home.lon, snap.home.lat], zoom: 6 }); }}>center home</button>}
      </div>
      {main && <div className="map-time" data-testid="map-time">Map shows: {new Date(main.time).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET{main.live ? " (live)" : main.time > Date.now() ? " (forecast)" : " (past)"}</div>}
      </div>
      {phase === "forecast" && <div className="fc-hatch" aria-hidden="true" />}
      {phase === "forecast" && <div className="fc-flag" data-testid="forecast-flag">FORECAST, not observed</div>}
      {radarOn && (
        <div className={`radar-ctl ph-${phase}`} data-testid="radar-ctl">
          {loopFrames.length > 1 && <button className="btn on" data-testid="radar-loop" onClick={() => setLoopIdx((i) => (i == null ? 0 : null))}>
            {looping ? "❚❚ Pause" : phase === "forecast" ? "▶ Play forecast radar" : "▶ Radar: last 2 hours"}</button>}
          <span className={`rv-badge ${loopFrame ? (loopFrame.forecast ? "fc" : "past") : view.kind === "forecast" ? "fc" : view.kind === "observed" && view.latest ? "live" : view.kind === "observed" ? "past" : "none"}`}>
            {loopFrame ? (loopFrame.forecast ? "FORECAST" : "REPLAY") : view.kind === "forecast" ? "FORECAST" : view.kind === "observed" && view.latest ? "LIVE" : view.kind === "observed" ? "PAST" : "NO RADAR"}</span>
          <span data-testid="radar-note">{shownLabel}</span>
          {radarLoading && <span className="rv-loading" data-testid="radar-loading">{radarState.s === "slow" ? "slow connection, showing what has loaded" : "loading radar… (previous image kept)"}</span>}
          {looping && <div className="frame-dots">{loopFrames.map((_, i) => <i key={i} className={i === loopIdx ? "on" : ""} />)}</div>}
        </div>
      )}
      {!keyOpen && <button className="map-key-btn" data-testid="map-key-toggle" aria-expanded="false" onClick={() => setKeyOpen(true)}>Map key ▸</button>}
      {keyOpen && <div className="map-legend" data-testid="map-legend" role="region" aria-label="Map key and sources">
        <div className="map-legend-head"><b>Map key and sources</b><button className="btn" data-testid="map-key-close" aria-expanded="true" onClick={() => setKeyOpen(false)} title="Hide the map key">hide ✕</button></div>
        {layers.outages && <div><OutageRamp />Power outages: Tallahassee regions (City of Tallahassee Utilities), dashed counties (ORNL ODIN), <span style={{ color: "#ffb020" }}>●</span> outages, grouped when zoomed out (number = customers).</div>}
        {ghost && <div><span style={{ color: "#ff5a4f" }}>━</span> Path from now to the selected time · <span style={{ color: "#ff5a4f" }}>◌</span> Time-sliced cone circle, NHC 2026 radii (where the center will likely be, 2 times in 3) · <span style={{ color: "#ffd43b" }}>▧</span><span style={{ color: "#f08c00" }}>▧</span><span style={{ color: "#d6336c" }}>▧</span> Tropical-storm, 58 mph and hurricane-force wind areas at that time (NHC wind radii) · <span style={{ color: "#e3a64a" }}>━</span> Where tropical-storm winds have likely arrived by then</div>}
        <div className={`stale-${st("nhcgis")}`}>{storm ? `${className(storm.classification)} ${storm.name}` : "No storm"} · NHC advisory {gis?.advisoryNumber ?? "—"} · {fmtET(gis?.issuance)}</div>
        {layers.cone && <div className="cone-note">{CONE_TEXT}</div>}
        {(layers.tornado || layers.flood) && <div className={`stale-${st("hazards")}`}>
          Watches and warnings in effect {ghost && Math.abs(hazardTime - Date.now()) > 120_000 ? "at the selected time" : "now"}: {hzShown.length ? hzShown.length : "none on the map"} · Sources: NOAA Storm Prediction Center (watches, via Iowa Environmental Mesonet) and National Weather Service · updated {fmtET(f.hazards?.lastSuccess)}{st("hazards") !== "fresh" ? " · OUT OF DATE" : ""}
          {hazardTime > Date.now() + 120_000 && <><br />Future times only show watches and warnings already issued. New ones can be issued at any time.</>}
        </div>}
        {(layers.tornado || layers.flood) && <div className="ww-key">
          {[...(layers.tornado ? TORNADO_KINDS : []), ...(layers.flood ? FLOOD_KINDS : [])].map((k) => <span key={k}><i style={{ background: HAZARD_HEX[k] }} />{HAZARD_NAME[k]} </span>)}
        </div>}
        {mode !== "hazards" && <div className={`stale-${st("radar")}`}>Radar ({snap?.radar?.kind === "rainviewer" ? "RainViewer, backup" : "NOAA NEXRAD via Iowa Environmental Mesonet"}) · latest {fmtET(snap?.radar?.frames.at(-1)?.time)}</div>}
        {snap?.power.local && <div className={`stale-${st("power")}`}>{snap.power.local.name}: {snap.power.local.count} · as of {fmtET(f.power?.sourceTime)}</div>}
        {snap?.home.configured && <div className={`stale-${st("usgs")}`}>River gauges (USGS) · {fmtET(f.usgs?.sourceTime)} <span className="lg-dot r" />rising <span className="lg-dot s" />steady</div>}
        <div className={`stale-${st("ndbc")}`}>Buoys near the storm (NOAA) · {fmtET(f.ndbc?.sourceTime)}</div>
        {(snap?.tides?.length ?? 0) > 0 && <div className={`stale-${st("coops")}`}>Tide gauges (NOAA CO-OPS), color = water above predicted tide · {fmtET(f.coops?.sourceTime)}</div>}
        <div className="ww-key"><i style={{ background: WW_HEX.HWR }} />Hurricane warning <i style={{ background: WW_HEX.HWA }} />Hurricane watch <i style={{ background: WW_HEX.TWR }} />Tropical storm warning <i style={{ background: WW_HEX.TWA }} />Tropical storm watch</div>
        {layers.cameras && (snap?.cameras?.length ?? 0) > 0 && <div className={`stale-${st("cameras")}`}>Live cameras (white dots, click for the latest picture): USGS river and coast cameras{snap?.cameras?.some((c) => c.source === "Windy Webcams") ? " + Windy Webcams" : ""} · {fmtET(f.cameras?.sourceTime)}</div>}
        {evacZones && evacZones.features.length > 0 && <div>Evacuation zones for the place you looked up (Florida Division of Emergency Management): <span style={{ color: "#e03131" }}>A</span> leaves first, then <span style={{ color: "#f76707" }}>B</span>, <span style={{ color: "#fab005" }}>C</span>, <span style={{ color: "#74b816" }}>D</span>, <span style={{ color: "#1c7ed6" }}>E</span>. Your county issues the orders.</div>}
        {layers.satellite && <div>Satellite: GOES-19 infrared (cloud tops; brighter = colder, stronger storms) at {fmtET(goes.time)}{goes.clamped ? " (latest available, images arrive about 30 minutes late; not a forecast)" : ""} · NOAA / NASA GIBS</div>}
        {layers.nightlights && <div>NASA night lights satellite ({yesterdayUtc()}, clouds block it; post-storm use)</div>}
      </div>}
    </div>
  );
}
