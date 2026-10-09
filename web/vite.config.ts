import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: the browser only talks to our server, never to upstream feeds.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "localhost",
    strictPort: true,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
