import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { type SessionData, sessionQueryOptions } from "@/app";

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

    const [session, requestAuth] = await Promise.all([
      queryClient.ensureQueryData(sessionQueryOptions(authClient, context.session)),
      context.apiClient.auth.getContext(),
    ]);

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

    const auth: AuthContext = {
      isAuthenticated: true,
      user: session.user,
      session: session.session,
      activeOrganizationId:
        requestAuth.organization.activeOrganizationId ||
        session.session?.activeOrganizationId ||
        null,
      activeOrganizationRole: requestAuth.organization.member?.role ?? null,
      hasNearAccount: requestAuth.near.hasNearAccount,
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
