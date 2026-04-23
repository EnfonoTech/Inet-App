import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const PORTAL_BASE = "/assets/inet_app/portal/";
const ICON_192 = `${PORTAL_BASE}assets/inet-app-icon-192.png`;
const ICON_512 = `${PORTAL_BASE}assets/inet-app-icon-512.png`;
const ICON_192_MASK = `${PORTAL_BASE}assets/inet-app-icon-192-maskable.png`;
const ICON_512_MASK = `${PORTAL_BASE}assets/inet-app-icon-512-maskable.png`;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      manifestFilename: "pms-manifest.webmanifest",
      injectRegister: null,
      manifest: {
        name: "INET Field & Operations",
        short_name: "INET PMS",
        description: "INET telecom field execution, QC, and time logging.",
        start_url: "/pms/today",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        theme_color: "#1a2744",
        background_color: "#f6f8fb",
        categories: ["business", "productivity"],
        icons: [
          { src: ICON_192, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: ICON_512, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: ICON_192_MASK, sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: ICON_512_MASK, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Today's Work", short_name: "Today",   url: "/pms/today",           icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }] },
          { name: "Execute",      short_name: "Execute", url: "/pms/field-execute",   icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }] },
          { name: "QC / CIAG",    short_name: "QC",      url: "/pms/field-qc-ciag",   icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }] },
          { name: "History",      short_name: "History", url: "/pms/field-history",   icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }] },
          { name: "Time log",     short_name: "Time",    url: "/pms/field-timesheet", icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }] },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,json,webmanifest}"],
        globIgnores: ["**/node_modules/**/*"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "inet-pms-api-cache",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "inet-pms-images",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  base: PORTAL_BASE,
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
