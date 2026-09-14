import { isEnvValueBlank } from "./env-file";

// The env keys a local first-run must land before `bun run dev` can reach
// `/activity` without hitting "Activity relay is unavailable" (see
// docs/research/activity-relay-503.md). Order is check order, first failure wins.
export const REQUIRED_LOCAL_ENV_KEYS = [
  "ACTIVITY_SIGNING_MASTER_KEYS",
  "ACTIVITY_SIGNING_ACTIVE_KEY_VERSION",
  "ACTIVITY_RELAY_URL",
  "ACTIVITY_REDIS_URL",
] as const;

export function findMissingLocalEnvKey(envContent: string): string | undefined {
  return REQUIRED_LOCAL_ENV_KEYS.find((key) => isEnvValueBlank(envContent, key));
}
