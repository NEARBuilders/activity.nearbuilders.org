import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { ContractType } from "../../../api/src/contract.js";

export interface ActivityClientOptions {
  apiKey?: string;
}

export function createActivityClient(baseUrl: string, options?: ActivityClientOptions) {
  const origin = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (options?.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  const link = new RPCLink({
    origin,
    url: "/api/rpc",
    headers,
    fetch: (requestUrl, requestOptions) =>
      fetch(requestUrl, { ...requestOptions, credentials: "include" }),
  });

  return createORPCClient(link) as ContractRouterClient<ContractType>;
}
