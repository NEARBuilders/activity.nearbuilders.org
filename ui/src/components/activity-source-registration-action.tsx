import { WalletIcon } from "@phosphor-icons/react/ssr";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { OrgSwitcher } from "@/components/org-switcher";
import { Button } from "@/components/ui/button";
import { useOrganizationSwitcher } from "@/hooks/use-organization-switcher";
import type { ActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

export function ActivitySourceRegistrationAction({
  access,
}: {
  access: ActivitySourceRegistrationAccess;
}) {
  if (access === "organization-required" || access === "owner-required") {
    return <OrganizationAction />;
  }
  if (access === "near-required") {
    return <NearAction />;
  }
  return null;
}

function OrganizationAction() {
  const { organizations, activeOrgId, handleOrgSwitch } = useOrganizationSwitcher();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <OrgSwitcher
        organizations={organizations}
        activeOrgId={activeOrgId}
        onSwitch={handleOrgSwitch}
      />
      <Button asChild variant="outline" size="sm">
        <Link to="/organizations/new">Create an organization</Link>
      </Button>
    </div>
  );
}

function NearAction() {
  const auth = useAuthClient();
  const queryClient = useQueryClient();

  const connectNear = useMutation({
    mutationFn: async () => {
      const result: unknown = await auth.signIn.near();
      if (
        result &&
        typeof result === "object" &&
        "error" in result &&
        result.error &&
        typeof result.error === "object" &&
        "message" in result.error
      ) {
        throw new Error(String(result.error.message));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["near-linked-accounts"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Button
      type="button"
      size="sm"
      onClick={() => connectNear.mutate()}
      disabled={connectNear.isPending}
    >
      <WalletIcon />
      {connectNear.isPending ? "Connecting..." : "Connect NEAR wallet"}
    </Button>
  );
}
