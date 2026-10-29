import type { ContractType as authContract } from "../../../.bos/generated/auth/contract.d.ts";
import type { RouterContract } from "@orpc/contract";
import type { PluginClientEntry } from "every-plugin";

export type PluginsClient = {
  auth: PluginClientEntry<authContract>;
};
