export function resolveActivityRelayUrl(
  configuredUrl: string,
  runtimeOverride = process.env.ACTIVITY_RELAY_URL,
): string {
  return runtimeOverride?.trim() || configuredUrl;
}
