import { describe, expect, it } from "vitest";
import { mmFromRgba, mmToIn, rainUrl } from "../src/sources/rainTotals";
import file from "../../config/mrms-precip-colors.json";
const rows = file.rows as [number, number, number, number, number][];

describe("rain so far (MRMS)", () => {
  it("maps IEM's MRMS colors back to mm", () => {
    expect(mmFromRgba(0, 254, 18, 255, rows)).toBe(18.5);
    expect(mmFromRgba(254, 144, 0, 255, rows)).toBe(65);
  });
  it("transparent = no rain", () => expect(mmFromRgba(0, 0, 0, 0, rows)).toBe(0));
  it("inches, 2 decimals", () => { expect(mmToIn(65)).toBe(2.56); expect(mmToIn(18.5)).toBe(0.73); });
  it("asks for the exact point", () => { const u = rainUrl("p24h", 30.44, -84.28); expect(u).toContain("LAYERS=mrms_p24h"); expect(u).toContain("BBOX=-84.3300,30.3900,-84.2300,30.4900"); });
});
