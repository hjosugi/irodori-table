import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const reactCompilerEnabled = process.env.IRODORI_REACT_COMPILER !== "0";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react({
      babel: {
        plugins: reactCompilerEnabled ? ["babel-plugin-react-compiler"] : [],
      },
    }),
  ],

  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          if (
            id.includes("/@replit/codemirror-vim/")
          ) {
            return "editor-vim-vendor";
          }
          if (id.includes("/@codemirror/lang-sql/")) {
            return "editor-sql-vendor";
          }
          if (id.includes("/@codemirror/") || id.includes("/codemirror/")) {
            return "editor-vendor";
          }
          if (id.includes("/lucide-react/") || id.includes("/lucide/")) {
            return "icon-vendor";
          }
          if (id.includes("/sql-formatter/")) {
            return "sql-vendor";
          }
          return "vendor";
        },
      },
    },
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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
