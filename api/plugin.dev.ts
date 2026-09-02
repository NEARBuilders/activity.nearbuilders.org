/**
 * Dev-mode plugin configuration for the local API server.
 *
 */

import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import packageJson from "./package.json" with { type: "json" };
import type Plugin from "./src/index";

const DEVELOPMENT_MASTER_KEYS = JSON.stringify({
  v1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
});

export default {
  pluginId: packageJson.name,
  port: Number(process.env.PORT) || 3001,
  config: {
    variables: {
      activityNostrBindingContract:
        process.env.ACTIVITY_NOSTR_BINDING_CONTRACT || "contextual.near",
      activityNostrBindingRelay:
        process.env.ACTIVITY_NOSTR_BINDING_RELAY || "wss://relay.nearbuilders.org",
      activityNostrKvApiUrl:
        process.env.ACTIVITY_NOSTR_KV_API_URL || "https://kv.main.fastnear.com",
    },
    secrets: {
      API_DATABASE_URL: process.env.API_DATABASE_URL || "pglite:.bos/api/:memory:",
      ACTIVITY_SIGNING_MASTER_KEYS:
        process.env.ACTIVITY_SIGNING_MASTER_KEYS || DEVELOPMENT_MASTER_KEYS,
      ACTIVITY_SIGNING_ACTIVE_KEY_VERSION: process.env.ACTIVITY_SIGNING_ACTIVE_KEY_VERSION || "v1",
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
