import type { ApiClient } from "./api";

type PreparedRegistryWrite = {
  data: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
  };
};

export type OptionalAppsClient = {
  prepareRegistryMetadataWrite(input: Record<string, unknown>): Promise<PreparedRegistryWrite>;
  prepareRegistryConfigWrite(input: Record<string, unknown>): Promise<PreparedRegistryWrite>;
};

/**
 * Access the inherited apps client only when that optional plugin is composed.
 * This scaffold intentionally starts with no application plugins.
 */
export function getOptionalAppsClient(client: ApiClient): OptionalAppsClient | null {
  const apps = (client as ApiClient & { apps?: Partial<OptionalAppsClient> }).apps;
  if (
    !apps ||
    typeof apps.prepareRegistryMetadataWrite !== "function" ||
    typeof apps.prepareRegistryConfigWrite !== "function"
  ) {
    return null;
  }
  return apps as OptionalAppsClient;
}
