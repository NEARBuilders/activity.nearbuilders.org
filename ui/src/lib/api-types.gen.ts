import type { ContractType as BaseApiContract } from "../../../api/src/contract.ts";
import type { ContractType as authContract } from "../../../.bos/generated/auth/contract.d.ts";
import type { ContractType as nostrContract } from "../../../.bos/generated/plugins/nostr/contract.d.ts";

export type ApiContract = BaseApiContract & {
  auth: authContract;
  nostr: nostrContract;
};
