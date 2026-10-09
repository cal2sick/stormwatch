import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

// Last-known-good JSON on disk so restarts and outages still show data. TODO (M4): SQLite history.
export function writeCache(name: string, value: unknown) {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${name}.json`);
  writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
  renameSync(file + ".tmp", file);
}

export function readCache<T>(name: string): T | null {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return null; }
}
