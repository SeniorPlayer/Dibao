import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DIBAO_API_PROXY ?? "http://127.0.0.1:8080",
        changeOrigin: true
      }
    }
  }
});
