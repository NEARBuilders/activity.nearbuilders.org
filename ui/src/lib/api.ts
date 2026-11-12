/**
 * oRPC API client factory and TanStack Query integration.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { useRouter } from "@tanstack/react-router";
import { createApiClient as createFrameworkApiClient } from "everything-dev/ui/api";
import { apiConnectionError } from "@/app";
import type { ApiContract } from "./api-types.gen";

export type { ApiContract };
export type ApiClient = ContractRouterClient<ApiContract>;

export function createApiClient(
  runtimeConfig: { hostUrl: string; rpcBase: string },
  headers?: Headers,
): ApiClient {
  if (!runtimeConfig.hostUrl) {
    throw new Error("Missing runtime host URL");
  }

  return createFrameworkApiClient<ApiContract>(
    {
      hostUrl: runtimeConfig.hostUrl,
      rpcBase: runtimeConfig.rpcBase as `/${string}`,
      connectionError: apiConnectionError,
    },
    headers,
  );
}

export function useApiClient(): ApiClient {
  return useRouter().options.context.apiClient;
}

export function useOrpc() {
  const client = useApiClient();
  return createTanstackQueryUtils(client);
}
