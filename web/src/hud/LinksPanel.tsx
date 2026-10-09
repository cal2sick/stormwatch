import Panel from "./Panel";

const LINKS = [
  { name: "National Hurricane Center", url: "https://www.nhc.noaa.gov" },
  { name: "National Weather Service", url: "https://www.weather.gov" },
  { name: "Ready.gov: hurricanes", url: "https://www.ready.gov/hurricanes" },
  { name: "FEMA: find your local emergency management", url: "https://www.fema.gov/locations" },
  { name: "GOES-East satellite", url: "https://www.star.nesdis.noaa.gov/GOES/index.php" },
];

/** Official quick links (these always win over this HUD). */
export default function LinksPanel({ area, extra, office }: { area?: string; extra?: { name: string; url: string }[]; office?: string | null }) {
  // Your local NWS office comes from the NWS points lookup for your own location (nothing hard-coded).
  const local = office ? [{ name: `Your local NWS office (${office})`, url: `https://www.weather.gov/${office.toLowerCase()}` }] : [];
  return (
    <Panel title="Official sources" source="official links" time={null} area={area}>
      <div className="links">
        {[...local, ...LINKS, ...(extra ?? [])].map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">↗ {l.name}</a>)}
      </div>
    </Panel>
  );
}
