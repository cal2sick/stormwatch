import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { bestShift, fromMerc, mercBox, pngIntensity, stormMotion, toMerc } from "../src/sources/radarMotion";
import { usableScans } from "../src/sources/radar";

function blob(w: number, h: number, cx: number, cy: number) {
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v[y * w + x] = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 40) + 0.6 * Math.exp(-((x - cx - 15) ** 2 + (y - cy + 9) ** 2) / 15);
  return v;
}
/** Tiny RGBA PNG writer (filter 0) for the decoder test. */
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (t: string, d: Buffer) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "ascii"); d.copy(b, 8); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("smooth live radar: motion estimate", () => {
  it("recovers a known shift between two scans (sub-pixel)", () => {
    const a = blob(64, 64, 30, 32), b = blob(64, 64, 33.5, 30);
    const s = bestShift(a, b, 64, 64, 8)!;
    expect(s.dx).toBeCloseTo(3.5, 0); expect(s.dy).toBeCloseTo(-2, 0); expect(s.score).toBeGreaterThan(0.9);
  });
  it("returns null when there is almost no echo", () => {
    expect(bestShift(new Float32Array(64 * 64), new Float32Array(64 * 64), 64, 64)).toBeNull();
  });
  it("decodes RGBA PNGs to intensity", () => {
    const d = pngIntensity(png(4, 3, (x) => (x === 2 ? [255, 255, 255, 255] : [0, 0, 0, 0])));
    expect(d.w).toBe(4); expect(d.h).toBe(3); expect(d.v[2]).toBeCloseTo(1); expect(d.v[0]).toBe(0);
  });
  it("mercator helpers round-trip and storm-motion fallback points the right way", () => {
    const [lon, lat] = fromMerc(...toMerc(-84.3, 30.44)); expect(lon).toBeCloseTo(-84.3, 6); expect(lat).toBeCloseTo(30.44, 6);
    const b = mercBox(-84.3, 30.44, 1000); expect(b[2] - b[0]).toBeCloseTo(2000);
    const m = stormMotion(0, 10, 30, -84); expect(m.vy).toBeGreaterThan(0); expect(Math.abs(m.vx)).toBeLessThan(1e-9); expect(m.method).toBe("storm-motion");
  });
  it("uses the newest scan once it is 2 minutes old", () => {
    const now = Date.parse("2026-10-09T22:42:00Z");
    expect(usableScans([{ ts: "2026-10-09T22:35Z" }, { ts: "2026-10-09T22:40Z" }, { ts: "2026-10-09T22:41Z" }], now).map((s) => s.ts)).toEqual(["2026-10-09T22:35Z", "2026-10-09T22:40Z"]);
  });
});
