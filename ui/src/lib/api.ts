/**
 * oRPC API client factory and TanStack Query integration.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { useRouter } from "@tanstack/react-router";
import { createRpcClient } from "every-plugin/client";
import { apiConnectionError } from "@/app";
import type { ApiContract } from "./api-types.gen";

export type { ApiContract };
export type ApiClient = ContractRouterClient<ApiContract>;

let browserApiClient: ApiClient | null = null;

export function createApiClient(
  runtimeConfig: { hostUrl: string; rpcBase: string },
  headers?: Headers,
): ApiClient {
  if (!runtimeConfig.hostUrl) {
    throw new Error("Missing runtime host URL");
  }

  if (typeof window !== "undefined" && !headers && browserApiClient) {
    return browserApiClient;
  }

  const client: ApiClient = createRpcClient<ApiContract>(
    {
      hostUrl: runtimeConfig.hostUrl,
      path: runtimeConfig.rpcBase as `/${string}`,
      connectionError: apiConnectionError,
    },
    headers,
  );

  if (typeof window !== "undefined" && !headers) {
    browserApiClient = client;
  }

  return client;
}

export function useApiClient(): ApiClient {
  return useRouter().options.context.apiClient;
}

export function useOrpc() {
  const client = useApiClient();
  return createTanstackQueryUtils(client);
}
