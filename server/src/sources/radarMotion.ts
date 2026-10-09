// Radar motion estimate (v0.6.1) for "Smooth live radar": how far the rain pattern moved between the last scans.
// Two downsampled IEM NEXRAD composite images (same box, EPSG:3857) are compared by cross-correlation over integer
// pixel shifts with a parabolic sub-pixel refinement. The result is a single drift vector (m/s in web-mercator meters),
// used only to slide the latest scan forward between scans. It is an ESTIMATE, labeled as such in the UI.
import { inflateSync } from "node:zlib";
import { USER_AGENT } from "../config.js";

export const MOTION_GRID = 192;
export const wmsUrl = (bbox: [number, number, number, number], iso: string, size: number) =>
  `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=nexrad-n0q-wmst&SRS=EPSG:3857`
  + `&BBOX=${bbox.map((v) => Math.round(v)).join(",")}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/png&TRANSPARENT=true&TIME=${iso.slice(0, 16)}:00Z`;

const R = 6378137;
export const toMerc = (lon: number, lat: number): [number, number] => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
export const fromMerc = (x: number, y: number): [number, number] => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
/** Square EPSG:3857 box of half-width `halfM` meters around a point. */
export const mercBox = (lon: number, lat: number, halfM: number): [number, number, number, number] => {
  const [x, y] = toMerc(lon, lat); return [x - halfM, y - halfM, x + halfM, y + halfM];
};

function toRgba(out: Buffer, w: number, h: number, ct: number, bpp: number, pal: Buffer | null, trns: Buffer | null): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * bpp, q = i * 4;
    if (ct === 6) { px[q] = out[o]; px[q + 1] = out[o + 1]; px[q + 2] = out[o + 2]; px[q + 3] = out[o + 3]; }
    else if (ct === 2) { px[q] = out[o]; px[q + 1] = out[o + 1]; px[q + 2] = out[o + 2]; px[q + 3] = 255; }
    else if (ct === 4) { px[q] = px[q + 1] = px[q + 2] = out[o]; px[q + 3] = out[o + 1]; }
    else if (ct === 0) { px[q] = px[q + 1] = px[q + 2] = out[o]; px[q + 3] = 255; }
    else { const k = out[o]; if (pal) { px[q] = pal[k * 3]; px[q + 1] = pal[k * 3 + 1]; px[q + 2] = pal[k * 3 + 2]; } px[q + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return px;
}
/** v0.7: decode an 8-bit PNG to RGBA pixels (same decoder as pngIntensity). */
export function pngRgba(buf: Buffer): { w: number; h: number; px: Uint8Array } {
  const d = decodePng(buf); return { w: d.w, h: d.h, px: toRgba(d.out, d.w, d.h, d.ct, d.bpp, d.pal, d.trns) };
}
/** Minimal PNG decoder: 8-bit RGBA / RGB / gray-alpha / palette, non-interlaced. Returns alpha*luma-ish intensity 0..1 per pixel. */
function decodePng(buf: Buffer) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8, w = 0, h = 0, depth = 0, ct = 0, interlace = 0; const idat: Buffer[] = []; let pal: Buffer | null = null, trns: Buffer | null = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; interlace = d[12]; }
    else if (type === "PLTE") pal = Buffer.from(d); else if (type === "tRNS") trns = Buffer.from(d); else if (type === "IDAT") idat.push(d); else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct]; if (!bpp) throw new Error(`unsupported PNG color type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ct, bpp, out, pal, trns };
}
export function pngIntensity(buf: Buffer): { w: number; h: number; v: Float32Array } {
  const { w, h, ct, bpp, out, pal, trns } = decodePng(buf);
  const v = new Float32Array(w * h), rgba = toRgba(out, w, h, ct, bpp, pal, trns);
  for (let i = 0; i < w * h; i++) v[i] = rgba[i * 4 + 3] / 255 * (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 765;
  return { w, h, v };
}

/** Shift (dx, dy) in pixels that best maps image a onto image b (b(x) ≈ a(x - d)); null if there is too little echo. */
export function bestShift(a: Float32Array, b: Float32Array, w: number, h: number, maxShift = 10): { dx: number; dy: number; score: number } | null {
  let mass = 0; for (let i = 0; i < a.length; i++) mass += a[i] > 0.05 ? 1 : 0;
  if (mass < a.length * 0.01) return null;
  const mean = (x: Float32Array) => { let s = 0; for (const t of x) s += t; return s / x.length; };
  const ma = mean(a), mb = mean(b);
  const S = 2 * maxShift + 1, score = new Float64Array(S * S);
  let best = -Infinity, bx = 0, by = 0;
  for (let dy = -maxShift; dy <= maxShift; dy++) for (let dx = -maxShift; dx <= maxShift; dx++) {
    let s = 0, na = 0, nb = 0;
    for (let y = maxShift; y < h - maxShift; y++) for (let x = maxShift; x < w - maxShift; x++) {
      const va = a[(y - dy) * w + (x - dx)] - ma, vb = b[y * w + x] - mb; s += va * vb; na += va * va; nb += vb * vb;
    }
    const c = na && nb ? s / Math.sqrt(na * nb) : 0; score[(dy + maxShift) * S + dx + maxShift] = c;
    if (c > best) { best = c; bx = dx; by = dy; }
  }
  const at = (dx: number, dy: number) => score[(dy + maxShift) * S + dx + maxShift];
  const sub = (l: number, c: number, r: number) => { const den = l - 2 * c + r; return den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (l - r) / den)) : 0; };
  const fx = Math.abs(bx) < maxShift ? sub(at(bx - 1, by), best, at(bx + 1, by)) : 0;
  const fy = Math.abs(by) < maxShift ? sub(at(bx, by - 1), best, at(bx, by + 1)) : 0;
  return { dx: bx + fx, dy: by + fy, score: best };
}

export interface RadarMotion {
  /** Drift in web-mercator meters per second (x east, y north). */
  vx: number; vy: number; speedMph: number; towardDeg: number;
  method: "radar-correlation" | "storm-motion"; fromScans: string[]; center: { lat: number; lon: number }; confidence: number;
}

async function png(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`IEM WMS ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Motion from the scans `older` -> `newer` over a ~600 mi box around (lat, lon). */
export async function radarMotion(lat: number, lon: number, older: string, newer: string): Promise<RadarMotion | null> {
  const half = 500_000, box = mercBox(lon, lat, half);
  const [a, b] = await Promise.all([png(wmsUrl(box, older, MOTION_GRID)), png(wmsUrl(box, newer, MOTION_GRID))]);
  const ia = pngIntensity(a), ib = pngIntensity(b);
  const s = bestShift(ia.v, ib.v, ia.w, ia.h);
  if (!s || s.score < 0.3) return null;
  const mPerPx = (2 * half) / ia.w, dt = (Date.parse(newer) - Date.parse(older)) / 1000;
  if (!(dt > 0)) return null;
  // Image y grows downward; mercator y grows north. Mercator meters are stretched by 1/cos(lat): convert speed to true ground speed.
  const vx = s.dx * mPerPx / dt, vy = -s.dy * mPerPx / dt, ground = Math.hypot(vx, vy) * Math.cos(lat * Math.PI / 180);
  const speedMph = ground * 2.23694;
  if (speedMph > 90) return null; // implausible: correlation locked onto noise
  return { vx, vy, speedMph: Math.round(speedMph), towardDeg: Math.round((Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360), method: "radar-correlation", fromScans: [older, newer], center: { lat, lon }, confidence: Math.round(s.score * 100) / 100 };
}

/** Fallback: the storm's own motion (NHC), as a drift vector. */
export function stormMotion(dirDeg: number, mph: number, lat: number, lon: number): RadarMotion {
  const ms = mph / 2.23694 / Math.cos(lat * Math.PI / 180), r = dirDeg * Math.PI / 180;
  return { vx: ms * Math.sin(r), vy: ms * Math.cos(r), speedMph: Math.round(mph), towardDeg: Math.round(dirDeg), method: "storm-motion", fromScans: [], center: { lat, lon }, confidence: 0.3 };
}
