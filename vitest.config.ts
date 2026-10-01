import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./apps/web/app", import.meta.url)),
    },
  },
  test: {
    exclude: ["apps/web/e2e/**", "**/node_modules/**"],
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx"],
    restoreMocks: true,
    // The first test in each API file starts Fastify cold while jsdom files
    // start in parallel, which can exceed the 5s default on a busy machine.
    testTimeout: 20_000,
  },
});
