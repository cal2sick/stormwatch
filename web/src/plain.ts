// v0.7.1 plain-English helpers for OUR OWN labels (source lines, legends, summaries).
// Never run official alert or advisory text through these: official text stays verbatim (AGENTS.md rule 4).

const RULES: [RegExp, string][] = [
  [/\bNHC ATCF best track \+ forecast\/advisory \(TCM\)/g, "National Hurricane Center past track and forecast"],
  [/\bNHC CurrentStorms\.json\b/g, "National Hurricane Center storm list"],
  [/\bNHC GIS \+ public advisory\b/g, "National Hurricane Center maps and advisory"],
  [/\bSPC watches \(IEM\)/g, "Storm Prediction Center watches (via Iowa Environmental Mesonet)"],
  [/\bNWS gridpoint forecast\b/g, "National Weather Service forecast"],
  [/\bNWS hourly \+ gridpoint forecast\b/g, "National Weather Service hourly forecast"],
  [/\(api\.weather\.gov\)/g, ""],
  [/\bNDBC buoys\b/g, "NOAA buoys"],
  [/\bNOAA CO-OPS\b/g, "NOAA tide gauges"],
  [/\bUSGS HIVIS\b/g, "U.S. Geological Survey cameras"],
  [/\bUSGS river gauges near you \(NWIS\)/g, "U.S. Geological Survey river gauges near you"],
  [/\bNOAA HRRR model\b/g, "NOAA short-range forecast model (HRRR)"],
  [/\bNEXRAD\b/g, "NOAA weather radar"],
  [/\bMRMS\b/g, "multi-radar rain estimate"],
  [/\bORNL ODIN\b/g, "Oak Ridge National Laboratory outage data"],
  [/\bEIA-861\b/g, "U.S. Energy Information Administration"],
  [/\bNWS ([A-Z][a-z]+(?: [A-Z][a-z]+)*) ([A-Z]{2})\b/g, "National Weather Service $1, $2"],
  [/\bNHC\b/g, "National Hurricane Center"],
  [/\bNWS\b/g, "National Weather Service"],
  [/\bSPC\b/g, "Storm Prediction Center"],
  [/\bUSGS\b/g, "U.S. Geological Survey"],
  [/\bIEM\b/g, "Iowa Environmental Mesonet"],
  [/\s{2,}/g, " "],
];
/** Spell out agency abbreviations in a label we wrote ourselves. */
export const plain = (s: string | null | undefined) => {
  let t = s ?? "";
  for (const [re, w] of RULES) t = t.replace(re, w);
  return t.trim();
};

/** Threat level -> plain risk word. Colors stay the same everywhere (green, yellow, orange, red). */
export const RISK_WORD: Record<string, string> = { GREEN: "Low", YELLOW: "Moderate", ORANGE: "Elevated", RED: "High", "DATA STALE": "Unknown (data is old)", "SET LOCATION": "Set your location" };
export const riskWord = (level: string | null | undefined) => RISK_WORD[level ?? ""] ?? "Unknown";
export const RISK_MEANING: Record<string, string> = {
  GREEN: "No storm threat for this place right now.",
  YELLOW: "A storm could affect this place. Stay informed.",
  ORANGE: "Storm impacts are possible here soon. Get ready now.",
  RED: "Dangerous weather is in effect or close. Act on official warnings.",
};

/** Alert severity rank for the one alert bar (most urgent first). */
export const ALERT_RANK = ["Tornado Warning", "Extreme Wind Warning", "Hurricane Warning", "Storm Surge Warning", "Flash Flood Warning", "Tropical Storm Warning",
  "Tornado Watch", "Hurricane Watch", "Storm Surge Watch", "Tropical Storm Watch", "Flash Flood Watch", "Flood Warning", "Severe Thunderstorm Warning", "Severe Thunderstorm Watch"];
export const alertRank = (event: string) => { const i = ALERT_RANK.findIndex((e) => event.toLowerCase().startsWith(e.toLowerCase())); return i < 0 ? 99 : i; };

/** What each alert asks you to do, in plain words (our advice, shown next to the official text). */
export const ALERT_ACTION: Record<string, string> = {
  "Tornado Warning": "Take shelter now in a small interior room on the lowest floor.",
  "Flash Flood Warning": "Move to higher ground now. Turn around, don't drown.",
  "Tornado Watch": "Tornadoes are possible. Know where you will take shelter, and keep alerts on.",
  "Hurricane Warning": "Hurricane winds are expected. Finish preparations and follow evacuation orders.",
  "Tropical Storm Warning": "Tropical-storm winds (39+ mph) are expected. Stay indoors.",
  "Flood Watch": "Flooding is possible. Avoid low roads.",
  "Flash Flood Watch": "Flash flooding is possible. Be ready to move to higher ground.",
};
export const alertAction = (event: string) => Object.entries(ALERT_ACTION).find(([k]) => event.toLowerCase().startsWith(k.toLowerCase()))?.[1] ?? null;
