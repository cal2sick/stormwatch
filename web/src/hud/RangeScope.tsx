// Range scope centered on home: crosshair, range rings, 10° bearing ticks, storm contact at its real
// bearing/distance, NHC forecast points projected around you. Static, no sweep animation.
import type { Snapshot, Storm, StormGis } from "../types";
import { bearingDeg, distanceMi } from "../geo";
import { compass } from "../format";

const S = 250, C = S / 2, RR = 100;
export default function RangeScope({ snap, storm, gis }: { snap: Snapshot | null; storm: Storm | undefined; gis: StormGis | undefined }) {
  if (!snap) return null;
  const h = snap.home;
  const range = Math.max(300, Math.ceil(((storm?.distanceMi ?? 0) * 1.25) / 100) * 100);
  const xy = (lat: number, lon: number) => {
    const d = distanceMi(h.lat, h.lon, lat, lon), b = (bearingDeg(h.lat, h.lon, lat, lon) * Math.PI) / 180;
    const r = (d / range) * RR;
    return [C + r * Math.sin(b), C - r * Math.cos(b)];
  };
  const track = (gis?.forecastPoints?.features ?? []).map((f) => { const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates; return xy(lat, lon); });
  const others = snap.storms.filter((s) => s.id !== storm?.id && s.distanceMi < range);
  const c = storm ? xy(storm.lat, storm.lon) : null;
  const closing = storm?.motionCpa ? !storm.motionCpa.receding : null;
  return (
    <div className="scope">
      <svg viewBox={`0 0 ${S} ${S}`}>
        <defs><clipPath id="scope"><circle cx={C} cy={C} r={RR} /></clipPath></defs>
        {[1, 2, 3].map((k) => <circle key={k} cx={C} cy={C} r={(RR * k) / 3} className={k === 3 ? "ring outer" : "ring"} />)}
        {Array.from({ length: 36 }, (_, i) => i * 10).map((a) => {
          const r0 = a % 90 === 0 ? RR - 8 : a % 30 === 0 ? RR - 5 : RR - 3, t = (a * Math.PI) / 180;
          return <line key={a} x1={C + r0 * Math.sin(t)} y1={C - r0 * Math.cos(t)} x2={C + RR * Math.sin(t)} y2={C - RR * Math.cos(t)} className="tick" />;
        })}
        {[0, 90, 180, 270].map((a) => { const t = (a * Math.PI) / 180; return <text key={a} x={C + (RR + 11) * Math.sin(t)} y={C - (RR + 11) * Math.cos(t) + 3} textAnchor="middle" className="lbl">{String(a).padStart(3, "0")}</text>; })}
        <line x1={C - RR} y1={C} x2={C + RR} y2={C} className="cross" /><line x1={C} y1={C - RR} x2={C} y2={C + RR} className="cross" />
        {[1, 2, 3].map((k) => <text key={k} x={C + 3} y={C - (RR * k) / 3 - 2} className="lbl dim">{Math.round((range * k) / 3)}</text>)}
        <g clipPath="url(#scope)">
          {track.length > 1 && <polyline points={track.map((p) => p.join(",")).join(" ")} className="track" />}
          {track.map((p, i) => <rect key={i} x={p[0] - 1.5} y={p[1] - 1.5} width={3} height={3} className="trackpt" />)}
          {others.map((s) => { const [x, y] = xy(s.lat, s.lon); return <rect key={s.id} x={x - 2.5} y={y - 2.5} width={5} height={5} className="other" />; })}
          {c && <g className="contact"><line x1={C} y1={C} x2={c[0]} y2={c[1]} className="bearing" /><circle cx={c[0]} cy={c[1]} r={5} /><line x1={c[0] - 8} y1={c[1]} x2={c[0] + 8} y2={c[1]} /><line x1={c[0]} y1={c[1] - 8} x2={c[0]} y2={c[1] + 8} /></g>}
        </g>
        <rect x={C - 3} y={C - 3} width={6} height={6} className="home" />
      </svg>
      <div className="scope-cap">
        {storm ? <>{storm.name} is {Math.round(storm.distanceMi)} miles {compass(storm.bearingDeg)} of home{closing == null ? "" : closing ? ", getting closer" : ", moving away"}</> : "No storm nearby"}
        <div className="dim">Rings are in miles. Estimate.</div>
      </div>
    </div>
  );
}
