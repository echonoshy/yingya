import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export default defineConfig(({ command }) => {
  const latest = JSON.parse(readFileSync(new URL('../versions.json', import.meta.url), 'utf8')).releases[0];
  const buildId = command === 'build' ? randomUUID() : 'development';
  const manifest = JSON.stringify({ schemaVersion: 1, buildId, version: latest.version, changes: latest.changes });
  return {
  root: __dirname,
  define: { __YINGYA_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), {
    name: 'yingya-app-version',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'app-version.json', source: manifest }); },
    configureServer(server) {
      server.middlewares.use('/app-version.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(manifest);
      });
    },
  }],
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
    assetsDir: "static",
  },
  server: {
    host: "0.0.0.0",
    port: 8798,
    strictPort: true,
    watch: {
      usePolling: process.env.YINGYA_VITE_POLLING === "1",
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8797", changeOrigin: false },
      "/assets": { target: "http://127.0.0.1:8797", changeOrigin: false },
    },
  },
  };
});
