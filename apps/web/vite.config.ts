import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
  server: {
    port: 1422,
    strictPort: false,
    proxy: {
      "/api": "http://localhost:1423",
    },
  },
});
