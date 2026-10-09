import { afterEach, describe, expect, it } from "vitest";
import { loadHome } from "../src/config.js";
import { usgsUrl } from "../src/sources/usgs.js";

describe("location comes only from .env", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("no HOME_LAT/HOME_LON means no home (neutral map center only)", () => {
    delete process.env.HOME_LAT; delete process.env.HOME_LON;
    const h = loadHome();
    expect(h.configured).toBe(false);
  });
  it("valid HOME_LAT/HOME_LON are used", () => {
    process.env.HOME_LAT = "27.5"; process.env.HOME_LON = "-82.5"; process.env.HOME_NAME = "Test";
    expect(loadHome()).toEqual({ name: "Test", lat: 27.5, lon: -82.5, configured: true });
  });
  it("invalid values are rejected", () => {
    process.env.HOME_LAT = "abc"; process.env.HOME_LON = "-82.5";
    expect(loadHome().configured).toBe(false);
  });
  it("USGS gauges are looked up around your location", () => {
    expect(usgsUrl({ name: "x", lat: 27.5, lon: -82.5, configured: true }, 0.5)).toContain("bBox=-83.0000,27.0000,-82.0000,28.0000");
  });
});
