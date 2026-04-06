import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/assets/inet_app/portal/",
  build: {
    outDir: "../inet_app/public/portal",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable filenames — no content hash — so pms.html never goes stale
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
