/**
 * FRAMEWORK-OWNED — reconciled from the parent template by `bos upgrade`.
 * Local edits are allowed: on the next upgrade the template version wins and your
 * copy is backed up under `.bos/sync-backup/`. To make a change permanent, file an
 * issue: https://github.com/NEARBuilders/everything-dev/issues
 */
import { config } from "dotenv";
import type { PluginConfigInput } from "every-plugin";
import packageJson from "./package.json" with { type: "json" };
import type Plugin from "./src/index";

// bos dev runs this with cwd=api/, so plain `dotenv/config` (cwd-relative)
// silently misses the repo-root .env every local override depends on.
config({ path: new URL("../.env", import.meta.url) });

const DEVELOPMENT_MASTER_KEYS = JSON.stringify({
  v1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
});

export default {
  pluginId: packageJson.name,
  port: Number(process.env.PORT) || 3001,
  config: {
    // child-owned-start
    variables: {
      activityNostrBindingContract:
        process.env.ACTIVITY_NOSTR_BINDING_CONTRACT || "contextual.near",
      activityNostrBindingRelay:
        process.env.ACTIVITY_NOSTR_BINDING_RELAY || "wss://relay.nearbuilders.org",
      activityNostrKvApiUrl:
        process.env.ACTIVITY_NOSTR_KV_API_URL || "https://kv.main.fastnear.com",
      activityRelayUrl: process.env.ACTIVITY_RELAY_URL || "wss://relay.nearbuilders.org",
      activityNostrRpcUrl:
        process.env.ACTIVITY_NOSTR_RPC_URL || "https://nostr.nearbuilders.org/api/rpc/nostr",
    },
    // child-owned-end
    secrets: {
      API_DATABASE_URL:
        process.env.API_DATABASE_URL ||
        (process.env.VITEST ? "pglite:.bos/api/:memory:" : "pglite:.bos/db"),
      ACTIVITY_SIGNING_MASTER_KEYS:
        process.env.ACTIVITY_SIGNING_MASTER_KEYS || DEVELOPMENT_MASTER_KEYS,
      ACTIVITY_SIGNING_ACTIVE_KEY_VERSION: process.env.ACTIVITY_SIGNING_ACTIVE_KEY_VERSION || "v1",
      ACTIVITY_REDIS_URL: process.env.ACTIVITY_REDIS_URL || "memory:",
      ACTIVITY_GITHUB_TOKEN: process.env.ACTIVITY_GITHUB_TOKEN || undefined,
      FASTNEAR_API_KEY: process.env.FASTNEAR_API_KEY || undefined,
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
