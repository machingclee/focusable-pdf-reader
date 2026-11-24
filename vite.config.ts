import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

// Restart marker: the dev server re-reads this file and rebuilds its dependency
// cache, which is also the escape hatch when the cache is out of sync.
// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  define: {
    // @ts-expect-error process is a nodejs global
    __VITE_ROOT__: JSON.stringify(process.cwd().replace(/\\/g, "/")),
  },

  // The note editor (Monaco, KaTeX, the remark/rehype pipeline) is reached
  // through a dynamic import, so the dev server's dependency scanner does not
  // always see it on the first pass and would serve it unbundled.
  optimizeDeps: {
    include: [
      "react-markdown",
      "remark-gfm",
      "remark-math",
      "rehype-highlight",
      "rehype-raw",
      "rehype-katex",
      "katex",
      "monaco-editor",
      "@monaco-editor/react",
      "lucide-react",
    ],
  },

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
      ignored: [
        "**/src-tauri/**",
        // The backend runs its own watcher (`bun --watch src/main.ts`, started by
        // `dev.sh` / `dev-win.ps1`) and writes `.*.bun-build` temp files into
        // `backend/` while it compiles. Vite watches the whole project root, so
        // it sees one of those appear and then tries to watch it while bun still
        // has it open. On Windows `fs.watch` answers EBUSY, and that arrives as
        // an `error` event on the FSWatcher with no handler — which kills vite.
        // Tauri is left polling :1420 ("Waiting for your frontend dev server to
        // start …"), or reports a failed `beforeDevCommand`, depending on where
        // the race landed. The backend is not part of the frontend bundle, so
        // there is nothing to watch there.
        "**/backend/**",
        // The same failure, other tools: an editor or the agent harness saving
        // atomically writes `.<name>.tmpdir/` next to the file and renames over
        // it. A dot-directory is never part of the bundle either.
        "**/.*/**",
      ],
    },
  },
}));
