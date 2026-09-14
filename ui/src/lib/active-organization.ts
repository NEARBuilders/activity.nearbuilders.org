import type { QueryClient } from "@tanstack/react-query";
import { type SessionData, sessionQueryKey } from "@/app";

interface SynchronizeActiveOrganizationOptions {
  organizationId: string;
  queryClient: QueryClient;
  setActiveOrganization: () => Promise<void>;
  confirmActiveOrganization: () => Promise<string | null>;
  invalidateRouter: () => void | Promise<void>;
}

export async function synchronizeActiveOrganization({
  organizationId,
  queryClient,
  setActiveOrganization,
  confirmActiveOrganization,
  invalidateRouter,
}: SynchronizeActiveOrganizationOptions): Promise<void> {
  await setActiveOrganization();
  await queryClient.invalidateQueries({ queryKey: ["organizations"] });
  const confirmedOrganizationId = await confirmActiveOrganization();
  if (confirmedOrganizationId !== organizationId) {
    throw new Error("The selected workspace was not confirmed by the API session");
  }

  await queryClient.cancelQueries({ queryKey: sessionQueryKey });
  queryClient.setQueryData<SessionData | null>(sessionQueryKey, (currentSession) => {
    if (!currentSession?.session) return currentSession;
    return {
      ...currentSession,
      session: {
        ...currentSession.session,
        activeOrganizationId: organizationId,
      },
    };
  });

  await invalidateRouter();
  await queryClient.invalidateQueries({
    queryKey: sessionQueryKey,
    refetchType: "none",
  });
}
