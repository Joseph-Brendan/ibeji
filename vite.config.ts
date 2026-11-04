import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  base: "/",
  plugins: [react()],
  publicDir: ".ibeji-public",
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    target: "es2022",
  },
});
