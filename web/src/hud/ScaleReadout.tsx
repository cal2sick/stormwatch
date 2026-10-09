// Minimal instrument readout: small-caps label, large mono value, thin 1px scale with ticks and a marker.
export interface Tick { v: number; label?: string }
export default function ScaleReadout({ label, value, min, max, invert = false, display, unit, sub, ticks = [], alert = false }: {
  label: string; value: number | null; min: number; max: number; invert?: boolean; display?: string; unit?: string;
  sub?: string; ticks?: Tick[]; alert?: boolean;
}) {
  const pos = (v: number) => { const f = Math.max(0, Math.min(1, (v - min) / (max - min))); return (invert ? 1 - f : f) * 100; };
  return (
    <div className={`readout ${alert ? "alert" : ""}`} role="img" aria-label={`${label}: ${display ?? value ?? "no data"} ${unit ?? ""}`}>
      <div className="ro-label">{label}</div>
      <div className="ro-value">{display ?? (value == null ? "—" : Math.round(value))}<span className="ro-unit">{unit}</span></div>
      <div className="ro-scale">
        {ticks.map((t) => <i key={t.v} className="ro-tick" style={{ left: `${pos(t.v)}%` }}>{t.label && <b>{t.label}</b>}</i>)}
        {value != null && <i className="ro-fill" style={invert ? { left: `${pos(value)}%`, right: 0 } : { left: 0, width: `${pos(value)}%` }} />}
        {value != null && <i className="ro-mark" style={{ left: `${pos(value)}%` }} />}
      </div>
      <div className="ro-ends"><span>{invert ? max : min}</span><span>{invert ? min : max}</span></div>
      {sub && <div className="ro-sub">{sub}</div>}
    </div>
  );
}
