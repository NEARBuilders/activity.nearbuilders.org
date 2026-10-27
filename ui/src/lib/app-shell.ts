import { getAccount, type RouterContext, type SessionData, sessionQueryOptions } from "@/app";
import { currentTenantOptions } from "@/lib/activity-queries";

export async function ensureShellData(
  context: Pick<RouterContext, "queryClient" | "authClient" | "apiClient" | "runtimeConfig"> & {
    session?: SessionData | null;
  },
) {
  const { queryClient, authClient, apiClient, runtimeConfig, session } = context;
  await Promise.all([
    queryClient.ensureQueryData(sessionQueryOptions(authClient, session)),
    queryClient.ensureQueryData(currentTenantOptions(apiClient, getAccount(runtimeConfig))),
  ]);
}
