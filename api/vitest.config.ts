import DrizzleORMMigrations from "@proj-airi/unplugin-drizzle-orm-migrations/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    testTimeout: 30000,
  },
  plugins: [DrizzleORMMigrations()],
});
