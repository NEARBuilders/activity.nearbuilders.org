import type { QueryClient } from "@tanstack/react-query";
import { type SessionData, sessionQueryKey } from "@/app";

interface SynchronizeActiveOrganizationOptions {
  organizationId: string;
  queryClient: QueryClient;
  confirmActiveOrganization: () => Promise<string | null>;
  invalidateRouter: () => void | Promise<void>;
}

export async function synchronizeActiveOrganization({
  organizationId,
  queryClient,
  confirmActiveOrganization,
  invalidateRouter,
}: SynchronizeActiveOrganizationOptions): Promise<void> {
  const previousSession = queryClient.getQueryData<SessionData | null>(sessionQueryKey);

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

  await queryClient.invalidateQueries({ queryKey: ["organizations"] });

  let confirmedOrganizationId: string | null;
  try {
    confirmedOrganizationId = await confirmActiveOrganization();
  } catch (confirmationError) {
    queryClient.setQueryData(sessionQueryKey, previousSession);
    throw confirmationError;
  }

  if (confirmedOrganizationId !== organizationId) {
    queryClient.setQueryData(sessionQueryKey, previousSession);
    throw new Error("The selected workspace was not confirmed by the API session");
  }

  await invalidateRouter();
  await queryClient.invalidateQueries({
    queryKey: sessionQueryKey,
    refetchType: "none",
  });
}
