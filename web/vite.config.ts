import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
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
      "/api": "http://127.0.0.1:8797",
      "/assets": "http://127.0.0.1:8797",
    },
  },
});
