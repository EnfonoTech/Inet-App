import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/pms/",
  build: {
    outDir: "../inet_app/public/portal",
    emptyOutDir: true,
  },
});
