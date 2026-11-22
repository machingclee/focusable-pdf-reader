import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The diagram is served by the backend itself, so the production build lands in
 * `../express-prisma-cqrs/src/event-storming/public` and every URL is rooted at
 * `/event-storming/`. From there the page calls `GET /docs/commands` on its own
 * origin — no CORS, no proxy, no snapshot file.
 *
 * In development Vite serves the same app from `/`, and `/docs/*` is proxied to
 * the backend so the relative call works there too.
 */
const BACKEND_URL = process.env.BACKEND_URL?.trim() || "http://127.0.0.1:4317";
const OUT_DIR = resolve(import.meta.dirname, "..", "..", "express-prisma-cqrs", "src", "event-storming", "public");

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/event-storming/" : "/",
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // The assets ship with the backend source rather than with this project.
    copyPublicDir: true,
  },
  server: {
    port: 5183,
    proxy: {
      // Same path the browser calls, so the app has one endpoint in both modes.
      "/docs": {
        target: BACKEND_URL,
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 5184,
    proxy: {
      "/docs": {
        target: BACKEND_URL,
        changeOrigin: false,
      },
    },
  },
}));
