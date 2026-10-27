import { createFileRoute, Outlet } from "@tanstack/react-router";
import { resolveActiveOrganizationMembership } from "@/lib/activity-source-permissions";
import { ensureShellData } from "@/lib/app-shell";
import { requireSession } from "@/lib/auth";

const ACTIVE_ROLE_STALE_MS = 60 * 1000;

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async (args) => {
    const { context } = args;
    const { queryClient, authClient } = context;
    await ensureShellData(context);
    const { auth, session } = await requireSession(args);

    const activeOrganization = await resolveActiveOrganizationMembership({
      activeOrganizationId: auth.activeOrganizationId,
      getActiveMemberRole: () =>
        queryClient.fetchQuery({
          queryKey: ["active-organization-role", auth.activeOrganizationId],
          queryFn: async () => {
            const { data, error } = await authClient.organization.getActiveMember();
            if (error) throw new Error(error.message || "Failed to read the active workspace role");
            return { role: data?.role ?? null };
          },
          staleTime: ACTIVE_ROLE_STALE_MS,
        }),
    });

    return {
      auth: {
        ...auth,
        activeOrganizationId: activeOrganization.activeOrganizationId,
        activeOrganizationRole: activeOrganization.activeOrganizationRole,
        hasNearAccount: Boolean(authClient.near.getAccountId()),
      },
      session,
    };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { auth } = Route.useRouteContext();
  if (!auth) return null;
  return (
    <div className="h-full flex flex-col">
      <Outlet />
    </div>
  );
}
