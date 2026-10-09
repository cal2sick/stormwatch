// Live network check (opt-in: `npm run test:live -w server`). Fetches one real past-radar tile and one forecast tile.
import { describe, expect, it } from "vitest";
import { hrrrRadarUrl, iemRadarUrl, iemStampAt } from "../../web/src/map/sliderView";

const tile = (tpl: string) => tpl.replace("{z}", "6").replace("{x}", "16").replace("{y}", "26"); // Gulf coast
async function png(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "stormwatch-test (open source)" } });
  const b = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, size: b.length, isPng: b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 };
}
describe.skipIf(!process.env.LIVE_TESTS)("radar tiles (live network)", () => {
  it("past frame 40 minutes ago returns a non-empty PNG", async () => {
    const { stamp } = iemStampAt(Date.now() - 40 * 60_000);
    const r = await png(tile(iemRadarUrl(stamp)));
    expect(r.status).toBe(200); expect(r.isPng).toBe(true); expect(r.size).toBeGreaterThan(1000);
  }, 20_000);
  it("HRRR forecast tile for the latest run returns a non-empty PNG", async () => {
    const meta = await (await fetch("https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0060.json")).json() as { model_init_utc: string };
    const r = await png(tile(hrrrRadarUrl(meta.model_init_utc, 60)));
    expect(r.status).toBe(200); expect(r.isPng).toBe(true); expect(r.size).toBeGreaterThan(1000);
  }, 20_000);
});
