import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { Organization } from "@/app";
import { sessionQueryOptions, useAuthClient } from "@/app";
import { synchronizeActiveOrganization } from "@/lib/active-organization";

export function useOrganizationSwitcher() {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const user = session?.user;

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
    enabled: !!user,
  });

  const activeOrgId = session?.session?.activeOrganizationId;

  const handleOrgSwitch = async (organizationId: string) =>
    synchronizeActiveOrganization({
      organizationId,
      queryClient,
      setActiveOrganization: async () => {
        const { error } = await auth.organization.setActive({ organizationId });
        if (error?.status === 401) {
          await auth.signOut();
          queryClient.setQueryData(["session"], null);
          queryClient.removeQueries({ queryKey: ["activity-sources"] });
          await navigate({ to: "/login", search: { redirect: "/activity-sources" } });
          throw new Error("Your session expired. Sign in again to switch workspaces.");
        }
        if (error) throw new Error(error.message || "Failed to switch organization");
      },
      confirmActiveOrganization: async () => {
        const { data, error } = await auth.getSession({
          query: { disableCookieCache: true },
        });
        if (error) {
          throw new Error(error.message || "Failed to confirm the selected workspace");
        }
        return data?.session.activeOrganizationId ?? null;
      },
      invalidateRouter: () => router.invalidate(),
    });

  return {
    organizations: organizations ?? [],
    activeOrgId: activeOrgId ?? null,
    handleOrgSwitch,
  };
}
