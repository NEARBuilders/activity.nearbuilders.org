import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { type SessionData, sessionQueryOptions } from "@/app";
import { resolveActiveOrganizationMembership } from "@/lib/activity-source-permissions";

interface AuthContext {
  isAuthenticated: boolean;
  user: SessionData["user"] | null;
  session: SessionData["session"] | null;
  activeOrganizationId: string | null;
  activeOrganizationRole: string | null;
  hasNearAccount: boolean;
  isAnonymous: boolean;
  isAdmin: boolean;
  isBanned: boolean;
}

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient, authClient } = context;

    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );

    if (!session?.user) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    if (session.user.banned) {
      throw redirect({
        to: "/login",
        hash: "banned",
      });
    }

    const activeOrganization = await resolveActiveOrganizationMembership({
      activeOrganizationId: session.session?.activeOrganizationId ?? null,
      getActiveMemberRole: async ({ organizationId }) => {
        const { data, error } = await authClient.organization.getActiveMember({
          query: { organizationId },
        });
        if (error) throw new Error(error.message || "Failed to read the active workspace role");
        return { role: data?.role ?? null };
      },
    });

    const auth: AuthContext = {
      isAuthenticated: true,
      user: session.user,
      session: session.session,
      activeOrganizationId: activeOrganization.activeOrganizationId,
      activeOrganizationRole: activeOrganization.activeOrganizationRole,
      hasNearAccount: Boolean(authClient.near.getAccountId()),
      isAnonymous: session.user.isAnonymous || false,
      isAdmin: session.user.role === "admin",
      isBanned: session.user.banned || false,
    };
    return {
      auth,
      session,
    };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <div className="h-full flex flex-col">
      <Outlet />
    </div>
  );
}
