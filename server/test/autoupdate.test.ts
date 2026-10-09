import { describe, expect, it } from "vitest";
// @ts-ignore plain .mjs shared with the supervisor
import { decide, lockfilesChanged } from "../../scripts/autoupdate-lib.mjs";

describe("auto-update rules", () => {
  it("does nothing when up to date", () => expect(decide({ ahead: 0, behind: 0, dirty: ["web/src/App.tsx"] }).action).toBe("none"));
  it("pulls when behind and clean", () => expect(decide({ ahead: 0, behind: 2, dirty: [] }).action).toBe("pull"));
  it("only package-lock churn is discarded first", () => expect(decide({ ahead: 0, behind: 1, dirty: ["package-lock.json"] }).action).toBe("reset-lock"));
  it("never touches real local changes", () => {
    const d = decide({ ahead: 0, behind: 1, dirty: ["package-lock.json", "config/thresholds.json"] });
    expect(d.action).toBe("skip"); expect(d.reason).toMatch(/thresholds/);
  });
  it("skips a diverged branch", () => expect(decide({ ahead: 1, behind: 1, dirty: [] }).action).toBe("skip"));
  it("npm install only when deps change", () => {
    expect(lockfilesChanged(["web/src/App.tsx"])).toBe(false);
    expect(lockfilesChanged(["package-lock.json"])).toBe(true);
    expect(lockfilesChanged(["web/package.json"])).toBe(true);
  });
});

import { versionChanged } from "../../web/src/useAutoReload";
describe("page auto-reload", () => {
  const a = { version: "0.7.0", sha: "abc1234", builtAt: "2026-10-09T23:00:00.000Z" };
  it("same code and build: no reload", () => expect(versionChanged(a, { ...a })).toBe(false));
  it("new commit: reload", () => expect(versionChanged(a, { ...a, sha: "def5678" })).toBe(true));
  it("rebuilt web app: reload", () => expect(versionChanged(a, { ...a, builtAt: "2026-10-09T23:05:00.000Z" })).toBe(true));
  it("unknown first value: no reload", () => expect(versionChanged(null, a)).toBe(false));
});
