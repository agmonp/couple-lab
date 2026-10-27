import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The phone app shares the clean, pure modules of the desktop app through
// `@shared` (../src). tests/sharedImports.test.ts keeps that boundary honest.
const shared = fileURLToPath(new URL("../src", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@shared": shared } },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    fs: { allow: [".", shared, fileURLToPath(new URL("../public/fonts", import.meta.url))] }
  },
  build: { outDir: "dist", emptyOutDir: true }
});
