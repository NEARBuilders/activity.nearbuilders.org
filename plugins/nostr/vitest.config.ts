import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/bundle/**", "tests/types.d.ts", "node_modules/**", "dist/**"],
  },
});
