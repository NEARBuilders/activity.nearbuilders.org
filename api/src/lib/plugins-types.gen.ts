import type { ContractType as projectsContract } from "../../../.bos/generated/plugins/projects/contract.d.ts";
import type { ContractType as authContract } from "../../../.bos/generated/auth/contract.d.ts";
import type { RouterContract } from "@orpc/contract";
import type { PluginClientEntry } from "every-plugin";

export type PluginsClient = {
  projects: PluginClientEntry<projectsContract>;
  auth: PluginClientEntry<authContract>;
};
