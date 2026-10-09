import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

const LS_KEY = "stormwatch:last-snapshot";

/**
 * Snapshot via WebSocket with auto-reconnect. The server sends {type:"snapshot"} when content changes
 * and {type:"feeds"} heartbeats otherwise. The last snapshot is kept in localStorage so a reload
 * without network still shows the last known state (marked stale by the feed timestamps).
 */
export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(() => {
    try { const s = localStorage.getItem(LS_KEY); return s ? (JSON.parse(s) as Snapshot) : null; } catch { return null; }
  });
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    const accept = (s: Snapshot) => {
      if (!s || !s.feeds) return;
      setSnap(s);
      setLastMessage(Date.now());
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* quota */ } }, 500);
    };
    fetch("/api/snapshot").then((r) => r.json()).then(accept).catch(() => {});
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => { setConnected(true); retry = 1000; };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "snapshot") accept(m.snapshot);
        else if (m.type === "feeds") {
          setLastMessage(Date.now());
          setSnap((prev) => (prev ? { ...prev, feeds: m.feeds, generatedAt: m.generatedAt } : prev));
        }
      };
      ws.onclose = () => { setConnected(false); if (!closed) { setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); } };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, []);
  return { snap, connected, lastMessage };
}
