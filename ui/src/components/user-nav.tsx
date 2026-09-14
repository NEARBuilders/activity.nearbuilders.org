import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { Organization } from "@/app";
import { sessionQueryOptions, useAuthClient } from "@/app";
import { OrgSwitcher } from "@/components/org-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { synchronizeActiveOrganization } from "@/lib/active-organization";
import { getInitials } from "@/lib/utils";

export function UserNav() {
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

  const activeOrg = useMemo(() => {
    return organizations?.find((org) => org.id === activeOrgId);
  }, [organizations, activeOrgId]);

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.signOut();
      if (error) {
        throw new Error(error.message || "Failed to sign out");
      }
      await auth.near.disconnect().catch(() => {});
    },
    onSuccess: async () => {
      queryClient.setQueryData(["session"], null);
      queryClient.removeQueries({ queryKey: ["organizations"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await router.invalidate();
      await navigate({ to: "/", replace: true });
    },
    onError: (error: Error) => {
      console.error("Sign out error:", error);
    },
  });

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

  const autoSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!user || activeOrgId || !organizations?.length || autoSelection.current === user.id) return;
    const organization =
      organizations.find((org) => org.slug === user.id || org.metadata?.isPersonal === true) ??
      organizations[0];
    if (!organization) return;
    autoSelection.current = user.id;
    void handleOrgSwitch(organization.id).catch(() => {
      toast.error("Choose a workspace from the header to continue.");
    });
  }, [user, activeOrgId, organizations]);

  if (!user) {
    return (
      <Button asChild size="sm">
        <Link to="/login">Sign in</Link>
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <OrgSwitcher
        organizations={organizations ?? []}
        activeOrgId={activeOrgId}
        onSwitch={handleOrgSwitch}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-transparent"
            aria-label="Account menu"
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-secondary text-secondary-foreground">
                {getInitials(user.name || user.email || "U")}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="truncate text-sm font-normal">{user.email || user.id}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/home">Workspace</Link>
          </DropdownMenuItem>
          {activeOrg && (
            <DropdownMenuItem asChild>
              <Link to="/organizations/$slug" params={{ slug: activeOrg.slug }}>
                {activeOrg.name}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to="/settings">Settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              signOutMutation.mutate();
            }}
            disabled={signOutMutation.isPending}
          >
            {signOutMutation.isPending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
