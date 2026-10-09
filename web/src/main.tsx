import React from "react";
import ReactDOM from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./theme.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

// Service worker disabled: a stale cached shell made updates look "broken". Remove any old one.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if ("caches" in window) caches.keys().then((ks) => ks.forEach((k) => k.startsWith("stormwatch-") && caches.delete(k))).catch(() => {});
}
