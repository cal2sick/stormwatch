import { useEffect, useRef } from "react";
import type { Snapshot } from "./types";

/** Speak and/or notify on new warn/alert events. Both are opt-in (off by default). */
export function useAlerts(snap: Snapshot | null, voice: boolean, notify: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!snap) return;
    if (!seen.current) { seen.current = new Set(snap.events.map((e) => e.id)); return; } // don't replay history
    const fresh = snap.events.filter((e) => !seen.current!.has(e.id));
    fresh.forEach((e) => seen.current!.add(e.id));
    for (const e of fresh.reverse()) {
      if (e.level === "info") continue;
      if (voice) speak(e.text);
      if (notify && "Notification" in window && Notification.permission === "granted") new Notification("STORMWATCH", { body: e.text, tag: e.id });
    }
  }, [snap?.events, voice, notify]);
}

export function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02; u.pitch = 0.9;
  speechSynthesis.speak(u);
}
