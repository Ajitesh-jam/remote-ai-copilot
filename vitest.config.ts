import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@remote-ai-copilot/shared-types": path.resolve(
        __dirname,
        "packages/shared-types/src/index.ts"
      ),
      "@remote-ai-copilot/logger": path.resolve(
        __dirname,
        "packages/logger/src/index.ts"
      ),
    },
  },
});
