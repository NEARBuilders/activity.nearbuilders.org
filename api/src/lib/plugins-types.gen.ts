import type { ContractType as nostrContract } from "../../../plugins/nostr/src/contract.ts";
import type { ContractType as authContract } from "../../../.bos/generated/auth/contract.d.ts";
import type { RouterContract } from "@orpc/contract";
import type { PluginClientEntry } from "every-plugin";

export type PluginsClient = {
  nostr: PluginClientEntry<nostrContract>;
  auth: PluginClientEntry<authContract>;
};
