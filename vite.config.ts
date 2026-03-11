import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync } from "fs";

export default defineConfig({
  plugins: [
    {
      name: "copy-content-css",
      closeBundle() {
        copyFileSync(
          resolve(__dirname, "src/content/content.css"),
          resolve(__dirname, "dist/content.css")
        );
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/index.ts"),
        "audio-hook": resolve(__dirname, "src/content/audio-hook.ts"),
        popup: resolve(__dirname, "src/popup/popup.ts"),
        options: resolve(__dirname, "src/options/options.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name].[ext]",
      },
    },
    sourcemap: process.env.NODE_ENV === "development",
    minify: "terser",
    target: "es2022",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
