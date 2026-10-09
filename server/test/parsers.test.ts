import { describe, expect, it } from "vitest";
import { extractAdvisoryText, parseToaKml, toaLabelToIso, validTimeToIso } from "../src/sources/nhcGis.js";
import { parseRealtime2 } from "../src/sources/ndbc.js";
import { parseRetryAfter } from "../src/http.js";

describe("NHC parsers", () => {
  it("VALIDTIME DD/HHMM -> ISO", () => expect(validTimeToIso("10/0000", "2026-10-09T15:00:00.000Z")).toBe("2026-10-10T00:00:00.000Z"));
  it("month rollover", () => expect(validTimeToIso("01/1200", "2026-10-30T15:00:00.000Z")).toBe("2026-11-01T12:00:00.000Z"));
  it("TOA label in CDT -> ISO", () => expect(toaLabelToIso("Fri 2 pm", "CDT", "2026-10-09T15:00:00.000Z")).toBe("2026-10-09T19:00:00.000Z"));
  it("TOA label next day", () => expect(toaLabelToIso("Sat 2 am", "CDT", "2026-10-09T15:00:00.000Z")).toBe("2026-10-10T07:00:00.000Z"));
  it("parses TOA KML placemarks", () => {
    const kml = `<kml><Document><ExtendedData><Data name="timezone"><value>CDT</value></Data></ExtendedData>
      <Placemark> <description><![CDATA[<table><tr><td>Fri 2 pm</td></tr></table>]]></description>
      <LineString><coordinates> -85,29,0 -84,29,0 </coordinates></LineString></Placemark></Document></kml>`;
    const fc = parseToaKml(kml, "2026-10-09T15:00:00.000Z");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties!.time).toBe("2026-10-09T19:00:00.000Z");
  });
  it("advisory text keeps the pre block verbatim", () => {
    expect(extractAdvisoryText("<html><pre>LINE 1\n<a href='x'>hurricanes.gov</a> &amp; more</pre></html>")).toBe("LINE 1\nhurricanes.gov & more");
  });
});

describe("NDBC + http", () => {
  it("parses realtime2 newest row and converts units", () => {
    const txt = "#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n2026 10 09 16 20 110 12.0 17.0   3.7     7   6.3 108 1009.2  26.2  28.8  24.7   MM   MM    MM\n";
    const r = parseRealtime2(txt)!;
    expect(r.time).toBe("2026-10-09T16:20:00.000Z"); expect(r.windKt).toBe(23); expect(r.gustKt).toBe(33);
    expect(r.waveFt).toBe(12.1); expect(r.pressureMb).toBe(1009.2); expect(r.pressureTendencyMb).toBeNull();
  });
  it("Retry-After seconds and dates", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter(new Date(Date.parse("2026-01-01T00:01:00Z")).toUTCString(), Date.parse("2026-01-01T00:00:00Z"))).toBe(60);
    expect(parseRetryAfter(null)).toBeNull();
  });
});
