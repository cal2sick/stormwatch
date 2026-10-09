// Pure rules for the auto-update supervisor (tested in server/test/autoupdate.test.ts).
/** dirty = tracked paths with local changes. */
export function decide({ ahead, behind, dirty }) {
  if (!behind) return { action: "none" };
  if (ahead) return { action: "skip", reason: `local branch has ${ahead} commit(s) not on the remote (diverged); not updating. Run "git status" to see.` };
  const other = dirty.filter((f) => f !== "package-lock.json");
  if (other.length) return { action: "skip", reason: `you have local changes (${other.slice(0, 3).join(", ")}${other.length > 3 ? ", ..." : ""}); not updating so nothing of yours is overwritten.` };
  return { action: dirty.length ? "reset-lock" : "pull" };
}
export const lockfilesChanged = (files) => files.some((f) => /(^|\/)(package-lock\.json|package\.json)$/.test(f));
