import { afterEach, describe, expect, it } from "vitest";
import { loadHome } from "../src/config.js";
import { usgsUrl } from "../src/sources/usgs.js";

describe("home location: .env, else Florida State University", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("no HOME_LAT/HOME_LON means the default home: Florida State University", () => {
    delete process.env.HOME_LAT; delete process.env.HOME_LON; delete process.env.HOME_DEFAULT;
    const h = loadHome();
    expect(h).toMatchObject({ name: "Florida State University", configured: true, source: "default" });
    expect(h.lat).toBeCloseTo(30.4422, 3); expect(h.lon).toBeCloseTo(-84.2975, 3);
  });
  it("HOME_DEFAULT=off keeps the old 'no location set' mode", () => {
    delete process.env.HOME_LAT; delete process.env.HOME_LON; process.env.HOME_DEFAULT = "off";
    expect(loadHome().configured).toBe(false);
  });
  it("valid HOME_LAT/HOME_LON are used", () => {
    process.env.HOME_LAT = "27.5"; process.env.HOME_LON = "-82.5"; process.env.HOME_NAME = "Test";
    expect(loadHome()).toEqual({ name: "Test", lat: 27.5, lon: -82.5, configured: true, source: "env" });
  });
  it("invalid values are rejected", () => {
    process.env.HOME_LAT = "abc"; process.env.HOME_LON = "-82.5";
    expect(loadHome().source).toBe("default");
  });
  it("USGS gauges are looked up around your location", () => {
    expect(usgsUrl({ name: "x", lat: 27.5, lon: -82.5, configured: true }, 0.5)).toContain("bBox=-83.0000,27.0000,-82.0000,28.0000");
  });
});
