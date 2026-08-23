import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const mounts = [
    { url: "/pdfjs/cmaps", dir: path.join(pdfjsRoot, "cmaps") },
    { url: "/pdfjs/standard_fonts", dir: path.join(pdfjsRoot, "standard_fonts") },
  ];

  const serve = (server: ViteDevServer) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split("?")[0] ?? "";
      for (const mount of mounts) {
        if (url === mount.url || url.startsWith(`${mount.url}/`)) {
          const relative = decodeURIComponent(url.slice(mount.url.length)).replace(/^\/+/, "");
          const file = path.resolve(mount.dir, relative);
          if (!file.startsWith(mount.dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            next();
            return;
          }
          res.setHeader("Content-Type", "application/octet-stream");
          fs.createReadStream(file).pipe(res);
          return;
        }
      }
      next();
    });
  };

  return {
    name: "pdfjs-assets",
    configureServer: serve,
    configurePreviewServer: serve,
    closeBundle() {
      const outDir = path.resolve("dist");
      for (const mount of mounts) {
        fs.cpSync(mount.dir, path.join(outDir, mount.url.slice(1)), { recursive: true });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
