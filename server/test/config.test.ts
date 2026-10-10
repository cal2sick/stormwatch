import { afterEach, describe, expect, it } from "vitest";
import { loadHome } from "../src/config.js";
import { usgsUrl } from "../src/sources/usgs.js";

describe("location: .env, else none (v0.7.1: no built-in default location)", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("no HOME_LAT/HOME_LON means no location (neutral label, never a built-in place)", () => {
    delete process.env.HOME_LAT; delete process.env.HOME_LON;
    const h = loadHome();
    expect(h).toMatchObject({ name: "Your location", configured: false });
    expect(JSON.stringify(h)).not.toMatch(/Florida|FSU|Tallahassee/);
  });
  it("valid HOME_LAT/HOME_LON are used", () => {
    process.env.HOME_LAT = "27.5"; process.env.HOME_LON = "-82.5"; process.env.HOME_NAME = "Test";
    expect(loadHome()).toEqual({ name: "Test", lat: 27.5, lon: -82.5, configured: true, source: "env" });
  });
  it("invalid values are rejected", () => {
    process.env.HOME_LAT = "abc"; process.env.HOME_LON = "-82.5";
    expect(loadHome().configured).toBe(false);
  });
  it("USGS gauges are looked up around your location", () => {
    expect(usgsUrl({ name: "x", lat: 27.5, lon: -82.5, configured: true }, 0.5)).toContain("bBox=-83.0000,27.0000,-82.0000,28.0000");
  });
});
