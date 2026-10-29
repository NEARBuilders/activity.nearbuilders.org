import { App } from "everything-dev/descriptor";

// Authored app descriptor. The published config is canonicalized to JSON
// from this file; dev-only overrides live in bos.dev.ts (never published).
export default App({
  name: "activity.nearbuilders.org",
  extends: "bos://dev.everything.near/everything.dev",
  account: "nearbuilding.near",
  domain: "activity.nearbuilders.org",
  title: "Activity | NearBuilders",
  description:
    "Shared activity and reputation layer for the NEAR ecosystem — Activity Sources submit signed events through one HTTP gateway; Nostr relays store and distribute them.",
  repository: "https://github.com/NEARBuilders/activity.nearbuilders.org",
  platform: "2.0.0-rc.27",
  ci: {
    railway: {
      service: "activity-app",
    },
  },
  ui: {
    path: "ui",
  },
  api: {
    path: "api",
    variables: {
      activityNostrBindingContract: "contextual.near",
      activityNostrBindingRelay: "wss://relay.nearbuilders.org",
      activityNostrKvApiUrl: "https://kv.main.fastnear.com",
      activityRelayUrl: "wss://relay.nearbuilders.org",
      activityNostrRpcUrl: "https://nostr.nearbuilders.org/api/rpc/nostr",
    },
    secrets: [
      "API_DATABASE_URL",
      "ACTIVITY_SIGNING_MASTER_KEYS",
      "ACTIVITY_SIGNING_ACTIVE_KEY_VERSION",
      "ACTIVITY_REDIS_URL",
      "ACTIVITY_RELAY_URL",
    ],
  },
  plugins: {},
});
