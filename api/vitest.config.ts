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
    // Keeps tests hermetic: plugin.dev.ts loads the repo .env, whose values would otherwise send
    // tests to real relays, databases, Redis, or GitHub. dotenv never overwrites a variable that is
    // already set, and every consumer treats an empty value as unset, so tests fall back to their
    // in-process relay and in-memory stores.
    env: {
      ACTIVITY_RELAY_URL: "",
      ACTIVITY_NOSTR_RPC_URL: "",
      ACTIVITY_LOCAL_RELAY_ONLY: "",
      ACTIVITY_NOSTR_BINDING_RELAY: "",
      ACTIVITY_NOSTR_KV_API_URL: "",
      API_DATABASE_URL: "",
      ACTIVITY_REDIS_URL: "",
      ACTIVITY_GITHUB_TOKEN: "",
      ACTIVITY_SIGNING_MASTER_KEYS: "",
      ACTIVITY_SIGNING_ACTIVE_KEY_VERSION: "",
    },
  },
  plugins: [DrizzleORMMigrations()],
});
