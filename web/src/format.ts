const CLASS: Record<string, string> = {
  HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", SD: "Subtropical Depression",
  PTC: "Potential Tropical Cyclone", PC: "Post-Tropical Cyclone", TY: "Typhoon", STY: "Super Typhoon", MH: "Major Hurricane",
};
export const className = (c: string) => CLASS[c] ?? c;
const POINTS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast", "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
export const compassWords = (deg: number) => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const SHORT = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export const compass = (deg: number) => SHORT[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
export const ktToMph = (kt: number | null | undefined) => (kt == null ? null : Math.round(kt * 1.15078));
export const catNumber = (cat: string) => (/CAT (\d)/.exec(cat)?.[1] ?? null);
export const threatColor: Record<string, string> = { GREEN: "#7fae8c", YELLOW: "#c2ad5c", ORANGE: "#c47f45", RED: "#d23c34", "DATA STALE": "#7c837e", "SET LOCATION": "#7c837e" };

/** Saffir-Simpson colors (the standard NHC/Wikipedia track palette), by top sustained wind in mph. */
export function catColor(mph: number | null): string {
  if (mph == null) return "#9fb3c8";
  return mph < 39 ? "#5ebaff" : mph < 74 ? "#00faf4" : mph < 96 ? "#ffffcc" : mph < 111 ? "#ffe775" : mph < 130 ? "#ffc140" : mph < 157 ? "#ff8f20" : "#ff6060";
}
