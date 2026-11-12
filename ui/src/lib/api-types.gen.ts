import type { ContractType as BaseApiContract } from "../../../api/src/contract.ts";
import type { ContractType as authContract } from "../../../.bos/generated/auth/contract.d.ts";
import type { ContractType as projectsContract } from "../../../.bos/generated/plugins/projects/contract.d.ts";

export type ApiContract = BaseApiContract & {
  auth: authContract;
  projects: projectsContract;
};
