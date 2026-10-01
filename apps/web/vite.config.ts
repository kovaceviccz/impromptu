import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  optimizeDeps: {
    entries: [
      "app/root.tsx",
      "app/routes/home.tsx",
      "app/routes/debate.tsx",
      "app/routes/register.tsx",
      "app/routes/login.tsx",
      "app/routes/account.tsx",
    ],
  },
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000",
    },
  },
});
