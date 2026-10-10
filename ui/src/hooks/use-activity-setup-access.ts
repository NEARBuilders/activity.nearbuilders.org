import { useQuery } from "@tanstack/react-query";
import { sessionQueryOptions, useAuthClient } from "@/app";
import { useIsClient } from "@/hooks/use-client";
import { getActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

export function useActivitySetupAccess(auth: {
  hasNearAccount: boolean;
  activeOrganizationId: string | null;
  activeOrganizationRole: string | null;
}) {
  const authClient = useAuthClient();
  const nearState = authClient.useNearState();
  const isClient = useIsClient();

  const { data: linkedNearAccounts, isPending: linkedNearAccountsPending } = useQuery({
    queryKey: ["near-linked-accounts"],
    queryFn: async () => {
      const { data, error } = await authClient.near.listAccounts();
      if (error) throw new Error(error.message || "Failed to read linked NEAR accounts");
      return data?.accounts ?? [];
    },
    staleTime: 30_000,
  });

  const hasNearAccount =
    linkedNearAccounts !== undefined
      ? linkedNearAccounts.length > 0
      : isClient
        ? Boolean(nearState?.accountId) || auth.hasNearAccount
        : auth.hasNearAccount;

  const { data: liveSession } = useQuery(sessionQueryOptions(authClient));
  const activeOrganizationId =
    !isClient || liveSession === undefined
      ? auth.activeOrganizationId
      : (liveSession?.session?.activeOrganizationId ?? null);
  const activeOrganizationIdStale = activeOrganizationId !== auth.activeOrganizationId;

  const { data: liveActiveMember } = useQuery({
    queryKey: ["active-organization-member", activeOrganizationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getActiveMember();
      if (error) throw new Error(error.message || "Failed to read the active workspace role");
      return data;
    },
    enabled: activeOrganizationIdStale && Boolean(activeOrganizationId),
  });
  const activeOrganizationRole = activeOrganizationIdStale
    ? (liveActiveMember?.role ?? null)
    : auth.activeOrganizationRole;

  const resolvedAccess = getActivitySourceRegistrationAccess({
    activeOrganizationId,
    organizationRole: activeOrganizationRole,
    hasNearAccount,
  });
  const registrationAccess =
    linkedNearAccountsPending && resolvedAccess === "near-required" ? null : resolvedAccess;
  const linkedNearAccountIds = (linkedNearAccounts ?? [])
    .filter(({ network }) => network === "mainnet")
    .map(({ accountId }) => accountId);

  return {
    hasNearAccount,
    activeOrganizationId,
    activeOrganizationRole,
    registrationAccess,
    linkedNearAccounts,
    linkedNearAccountIds,
  };
}
