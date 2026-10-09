import { useEffect, useState } from "react";

export type AppVersion = { version: string; sha: string; builtAt: string | null };
/** True when the server is running different code or a different web build than this page loaded with. */
export const versionChanged = (a: AppVersion | null, b: AppVersion | null) => !!a && !!b && (a.sha !== b.sha || a.builtAt !== b.builtAt);

/** v0.7: poll /api/version; when it changes, show "Updated to vX, reloading" for 3 s, then reload. */
export function useAutoReload(everyMs = 20_000) {
  const [current, setCurrent] = useState<AppVersion | null>(null);
  const [updatingTo, setUpdatingTo] = useState<string | null>(null);
  useEffect(() => {
    let first: AppVersion | null = null, stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => fetch("/api/version", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((v: AppVersion | null) => {
      if (stop || !v?.sha) return;
      if (!first) { first = v; setCurrent(v); return; }
      if (versionChanged(first, v)) {
        stop = true; setUpdatingTo(`v${v.version} (${v.sha})`);
        timer = setTimeout(() => location.reload(), 3000);
      }
    }).catch(() => { /* server restarting: try again next tick */ });
    check(); const id = setInterval(check, everyMs);
    return () => { stop = true; clearInterval(id); if (timer) clearTimeout(timer); };
  }, [everyMs]);
  return { current, updatingTo };
}
