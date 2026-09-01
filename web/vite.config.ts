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
    port: 8002,
    strictPort: true,
    watch: {
      usePolling: process.env.YINGYA_VITE_POLLING === "1",
    },
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/assets": "http://127.0.0.1:3000",
      "/project-files": "http://127.0.0.1:3000",
    },
  },
});
