import type { ContractType as nostrContract } from "../../../.bos/generated/plugins/nostr/contract.d.ts";
import type { ContractType as authContract } from "../../../.bos/generated/auth/contract.d.ts";
import type { ContractRouterClient, AnyContractRouter } from "@orpc/contract";
type ClientFactory<C extends AnyContractRouter> = (context?: Record<string, unknown>) => ContractRouterClient<C>;

export type PluginsClient = {
  nostr: ClientFactory<nostrContract>;
  auth: ClientFactory<authContract>;
};
