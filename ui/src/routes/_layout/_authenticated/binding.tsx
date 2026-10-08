import {
  CheckCircleIcon as CheckCircle,
  RobotIcon as Robot,
  WarningIcon as Warning,
} from "@phosphor-icons/react/ssr";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useApiClient, useAuthClient } from "@/app";
import { ActivityLinkOnChainAction } from "@/components/activity-setup-actions";
import { ActivitySourceRegistration } from "@/components/activity-source-registration";
import { ActivitySourceRegistrationAction } from "@/components/activity-source-registration-action";
import type { CreateActivitySourceInput } from "@/components/activity-sources-model";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivitySetupAccess } from "@/hooks/use-activity-setup-access";
import { useActivitySourceCredentials } from "@/hooks/use-activity-source-credentials";

interface BindingSearch {
  sessionToken: string;
}

export const Route = createFileRoute("/_layout/_authenticated/binding")({
  validateSearch: (search: Record<string, unknown>): BindingSearch => ({
    sessionToken: typeof search.sessionToken === "string" ? search.sessionToken : "",
  }),
  head: () => ({
    meta: [{ title: "Connect your agent | NEAR Builders Activity" }],
  }),
  component: BindingPage,
});

function bindingSessionQueryKey(sessionToken: string) {
  return ["activity-binding-session", sessionToken] as const;
}

function organizationSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "project"}-${suffix}`;
}

function BindingPage() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { auth } = Route.useRouteContext();
  const { sessionToken } = Route.useSearch();
  const access = useActivitySetupAccess(auth);
  const [registeredSourceId, setRegisteredSourceId] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: bindingSessionQueryKey(sessionToken),
    queryFn: () => apiClient.getActivityBindingSession({ sessionToken }),
    enabled: Boolean(sessionToken),
    retry: false,
  });
  const session = sessionQuery.data ?? null;
  const draft = session?.draft ?? {};
  const projectName = draft.project?.title ?? draft.displayName ?? "your project";

  const sourcesQuery = useQuery({
    queryKey: ["activity-sources", auth.user?.id, access.activeOrganizationId],
    queryFn: () => apiClient.listActivitySources(),
    enabled: Boolean(access.activeOrganizationId) && access.registrationAccess === "allowed",
  });
  const targetSourceId = registeredSourceId ?? session?.sourceId ?? draft.sourceId ?? null;
  const source =
    (sourcesQuery.data ?? []).find(({ sourceId }) => sourceId === targetSourceId) ?? null;
  const credentials = useActivitySourceCredentials(source, source !== null);
  const isBound = credentials.identity?.bindingStatus === "bound";

  const refreshSession = () =>
    queryClient.invalidateQueries({ queryKey: bindingSessionQueryKey(sessionToken) });

  const createOrganization = useMutation({
    mutationFn: async () => {
      const { data, error } = await authClient.organization.create({
        name: projectName,
        slug: organizationSlug(projectName),
      });
      if (error || !data) throw new Error(error?.message || "Failed to create organization");
      const activated = await authClient.organization.setActive({ organizationId: data.id });
      if (activated.error) throw new Error(activated.error.message);
      return data;
    },
    onSuccess: async (organization) => {
      toast.success(`Organization "${organization.name}" created`);
      await queryClient.invalidateQueries();
      await router.invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create organization"),
  });

  const createSource = useMutation({
    mutationFn: (input: CreateActivitySourceInput) => apiClient.createActivitySource(input),
    onSuccess: async (created) => {
      setRegisteredSourceId(created.sourceId);
      toast.success("Activity Source registered");
      await queryClient.invalidateQueries({ queryKey: ["activity-sources"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to register Activity Source"),
  });

  const completeSession = useMutation({
    mutationFn: (sourceId: string) =>
      apiClient.completeActivityBindingSession({ sessionToken, sourceId }),
    onSuccess: async () => {
      toast.success("Your agent can now collect its API key");
      await refreshSession();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to finish the binding session"),
  });

  const linkAndComplete = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("Register the source first");
      await credentials.linkOnChain.mutateAsync();
      await completeSession.mutateAsync(source.sourceId);
    },
  });

  const linkNearAccount = useMutation({
    mutationFn: async () => {
      await authClient.near.disconnect();
      let linkError: Error | null = null;
      await authClient.near.link({
        onError: (error) => {
          linkError = error;
        },
      });
      if (linkError) throw linkError;
    },
    onSuccess: async () => {
      toast.success("NEAR account added to your profile");
      await queryClient.invalidateQueries({ queryKey: ["near-linked-accounts"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to add NEAR account"),
  });

  if (!sessionToken || sessionQuery.isError || session?.status === "expired") {
    return (
      <BindingShell>
        <Card className="gap-2 p-5">
          <div className="flex items-center gap-2">
            <Warning className="size-5 text-destructive" />
            <h1 className="text-base font-semibold text-foreground">This link no longer works</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            It is invalid or has expired. Ask your agent to start a new binding session.
          </p>
        </Card>
      </BindingShell>
    );
  }

  if (!session) {
    return (
      <BindingShell>
        <Skeleton className="h-40 w-full" />
      </BindingShell>
    );
  }

  if (session.status === "ready" || session.status === "claimed") {
    return (
      <BindingShell>
        <Card className="gap-3 p-5" aria-label="Binding complete">
          <div className="flex items-center gap-2">
            <CheckCircle className="size-6 text-brand-accent" weight="fill" />
            <h1 className="text-base font-semibold text-foreground">Return to your agent</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {session.status === "claimed"
              ? "Your agent has collected its API key and can finish the integration."
              : "Your agent will collect its API key in a moment and finish the integration."}{" "}
            {session.sourceId} is under review. Its events are accepted now and count on the
            leaderboard once it is approved.
          </p>
          <div>
            <Button asChild variant="outline" size="sm">
              <Link to="/activity-sources">View your sources</Link>
            </Button>
          </div>
        </Card>
      </BindingShell>
    );
  }

  const renderStep = () => {
    if (access.registrationAccess === null) return <Skeleton className="h-24 w-full" />;
    if (access.registrationAccess === "near-required") {
      return (
        <StepCard
          title="Connect your NEAR wallet"
          description="Sign in with the mainnet NEAR account that will own this source."
        >
          <ActivitySourceRegistrationAction access="near-required" />
        </StepCard>
      );
    }
    if (access.registrationAccess !== "allowed") {
      return (
        <StepCard
          title={`Create an organization for ${projectName}`}
          description="A source belongs to one organization you own. We can create one named after the project, or you can pick an existing one."
        >
          <div className="space-y-3">
            <Button
              type="button"
              onClick={() => createOrganization.mutate()}
              disabled={createOrganization.isPending}
            >
              {createOrganization.isPending ? "Creating…" : `Create "${projectName}"`}
            </Button>
            <ActivitySourceRegistrationAction access={access.registrationAccess} />
          </div>
        </StepCard>
      );
    }
    if (sourcesQuery.isPending) return <Skeleton className="h-24 w-full" />;
    if (!source) {
      return (
        <StepCard
          title="Check the details"
          description="Your agent filled these in. Adjust anything, then register the source."
        >
          <ActivitySourceRegistration
            access="allowed"
            embedded
            defaultNearAccountId={access.linkedNearAccountIds[0] ?? ""}
            defaults={{
              sourceId: draft.sourceId,
              displayName: draft.displayName ?? draft.project?.title,
              nearAccountId: draft.nearAccountId,
              nearbuildersProjectId: draft.project?.id,
              eventTypes: draft.eventTypes,
            }}
            onImportProject={(reference) => apiClient.lookupNearbuildersProject({ reference })}
            isSubmitting={createSource.isPending}
            onCreate={async (input) => {
              await createSource.mutateAsync(input);
            }}
          />
        </StepCard>
      );
    }
    if (!isBound) {
      return (
        <StepCard
          title="Link your source on-chain"
          description={`Approve one transaction from ${source.nearAccountId}. It costs well under 0.001 NEAR. Your agent receives its API key as soon as it is confirmed.`}
        >
          <ActivityLinkOnChainAction
            requiredAccountId={source.nearAccountId}
            linkedAccountIds={access.linkedNearAccountIds}
            isLinking={linkAndComplete.isPending}
            isChecking={credentials.confirmBinding.isPending}
            isLinkingAccount={linkNearAccount.isPending}
            onLinkAccount={() => linkNearAccount.mutate()}
            canCheck={credentials.identity !== null}
            onLink={() => linkAndComplete.mutate()}
            onCheck={() => credentials.confirmBinding.mutate()}
          />
        </StepCard>
      );
    }
    return (
      <StepCard
        title="Send the API key to your agent"
        description={`${source.sourceId} is linked on-chain. Finish to let your agent collect its API key.`}
      >
        <Button
          type="button"
          onClick={() => completeSession.mutate(source.sourceId)}
          disabled={completeSession.isPending}
        >
          {completeSession.isPending ? "Finishing…" : "Send key to agent"}
        </Button>
      </StepCard>
    );
  };

  return (
    <BindingShell>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Connect {projectName} to Activity</h1>
        <p className="text-sm text-muted-foreground">
          Your coding agent asked to set up Activity for this project. You sign in, confirm the
          details, and approve one wallet transaction. The agent does the rest.
        </p>
        {draft.project?.url && (
          <p className="text-sm text-muted-foreground">
            Project:{" "}
            <a
              href={draft.project.url}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              {draft.project.title ?? draft.project.url}
            </a>{" "}
            on nearbuilders.org
          </p>
        )}
      </div>
      <Card className="flex-row items-center gap-4 p-5" aria-label="Match code">
        <Robot className="size-8 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Check that this code matches the one your agent showed you. If it does not, close this
            page.
          </p>
          <p className="font-mono text-2xl font-semibold tracking-widest text-foreground">
            {session.matchCode}
          </p>
        </div>
      </Card>
      {renderStep()}
    </BindingShell>
  );
}

function BindingShell({ children }: { children: ReactNode }) {
  return (
    <PageContainer>
      <div className="mx-auto w-full max-w-2xl space-y-4">{children}</div>
    </PageContainer>
  );
}

function StepCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-4 p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </Card>
  );
}
