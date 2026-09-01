import type { ContractType as authContract } from "../../../.bos/generated/auth/contract.d.ts";
import type { ContractRouterClient, AnyContractRouter } from "@orpc/contract";
type ClientFactory<C extends AnyContractRouter> = (context?: Record<string, unknown>) => ContractRouterClient<C>;

export type PluginsClient = {
  auth: ClientFactory<authContract>;
};
