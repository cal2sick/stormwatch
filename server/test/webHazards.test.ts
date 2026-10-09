import { describe, expect, it } from "vitest";
import { CONE_TEXT, hazardFeatures, homeBanner } from "../../web/src/hazards";
import { PLAIN } from "../src/sources/hazards.js";
import type { Hazard } from "../../web/src/types";

const NOW = Date.parse("2026-10-09T19:00:00Z");
const sq: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[-86, 30], [-85, 30], [-85, 31], [-86, 31], [-86, 30]]] };
const hz = (o: Partial<Hazard>): Hazard => ({ id: "h", kind: "tornadoWarning", title: "Tornado Warning", plain: "", onset: "2026-10-09T18:50:00Z",
  expires: "2026-10-09T19:30:00Z", issuer: "NWS Mobile AL", source: "test", url: null, headline: "H", description: "D", instruction: "TAKE COVER NOW!", geometry: sq, ...o });

describe("home banner", () => {
  it("tornado warning polygon over home -> red banner with verbatim text", () => {
    const b = homeBanner([hz({})], ["h"], [], NOW);
    expect(b.tornadoWarning?.instruction).toBe("TAKE COVER NOW!");
  });
  it("NWS point alert alone also triggers it", () => {
    const b = homeBanner([], [], [{ id: "a", event: "Tornado Warning", expires: "2026-10-09T19:30:00Z", ends: null, senderName: "NWS", headline: null, description: "verbatim", instruction: null, onset: null }], NOW);
    expect(b.tornadoWarning?.description).toBe("verbatim");
  });
  it("no banner when home is outside, or the warning expired", () => {
    expect(homeBanner([hz({})], [], [], NOW).tornadoWarning).toBeNull();
    expect(homeBanner([hz({})], ["h"], [], Date.parse("2026-10-09T19:31:00Z")).tornadoWarning).toBeNull();
  });
  it("prefers the numbered SPC watch", () => {
    const b = homeBanner([hz({ id: "w", kind: "tornadoWatch", title: "Tornado Watch 677", expires: "2026-10-10T01:00:00Z" })], ["w"],
      [{ id: "a", event: "Tornado Watch", expires: "2026-10-10T01:00:00Z", ends: null, senderName: "NWS", headline: null, description: "", instruction: null, onset: null }], NOW);
    expect(b.tornadoWatch?.title).toBe("Tornado Watch 677");
  });
});

describe("map features at slider time", () => {
  const list = [hz({}), hz({ id: "f", kind: "flashFloodWatch", title: "Flash Flood Watch", onset: "2026-10-10T00:00:00Z", expires: "2026-10-10T18:00:00Z" })];
  it("only kinds turned on, only in effect at t", () => {
    expect(hazardFeatures(list, NOW, ["tornadoWarning", "flashFloodWatch"]).features.map((f) => f.properties.id)).toEqual(["h"]);
    expect(hazardFeatures(list, Date.parse("2026-10-10T03:00:00Z"), ["tornadoWarning", "flashFloodWatch"]).features.map((f) => f.properties.id)).toEqual(["f"]);
    expect(hazardFeatures(list, NOW, ["flashFloodWatch"]).features).toHaveLength(0);
  });
  it("label carries expiry in ET", () => expect(hazardFeatures(list, NOW, ["tornadoWarning"]).features[0].properties.label).toBe("Tornado Warning · until Fri 3:30pm ET"));
});

describe("safety copy", () => {
  it("cone wording is exact", () => expect(CONE_TEXT).toBe("The cone shows where the center may go. Dangerous wind, rain, surge and tornadoes often happen outside it."));
  it("derived hazard text never uses banned words", () => {
    for (const t of [...Object.values(PLAIN), CONE_TEXT]) expect(t).not.toMatch(/\b(will hit|safe|all clear|guaranteed|exact)\b/i);
  });
});
