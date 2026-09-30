import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import {
  type ActivityGithubConfigurationInput,
  ActivityGithubIntegration,
} from "@/components/activity-github-integration";
import { ActivityOnboardingProgress } from "@/components/activity-onboarding-progress";
import {
  ActivityApiKeyAction,
  ActivityLinkOnChainAction,
  ActivitySetupComplete,
} from "@/components/activity-setup-actions";
import { ActivitySourceCredentials } from "@/components/activity-source-credentials";
import { ActivitySourceRegistration } from "@/components/activity-source-registration";
import { ActivitySourceRegistrationAction } from "@/components/activity-source-registration-action";
import {
  ActivitySourcesDashboard,
  type ActivitySourceView,
  type CreateActivitySourceInput,
  type ReviewActivitySourceInput,
  type UpdateActivitySourceTrustInput,
} from "@/components/activity-sources-dashboard";
import { PageContainer } from "@/components/layout/page-container";
import { useActivitySourceCredentials } from "@/hooks/use-activity-source-credentials";
import { useIsClient } from "@/hooks/use-client";
import { getActivityOnboardingSteps, pickOnboardingSource } from "@/lib/activity-onboarding";
import { getActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

const activitySourcesQueryKey = ["activity-sources"] as const;
const adminActivitySourcesQueryKey = ["activity-source-reviews", "all"] as const;

function githubQueryKey(sourceId: string) {
  return ["activity-source-github", sourceId] as const;
}

export const Route = createFileRoute("/_layout/_authenticated/activity-sources")({
  head: () => ({
    meta: [{ title: "Activity Sources | NEAR Builders" }],
  }),
  loader: async ({ context }) => {
    if (context.auth.activeOrganizationId) {
      await context.queryClient.ensureQueryData({
        queryKey: [
          ...activitySourcesQueryKey,
          context.auth.user?.id,
          context.auth.activeOrganizationId,
        ],
        queryFn: () => context.apiClient.listActivitySources(),
        staleTime: 30_000,
      });
    }

    if (context.auth.isAdmin) {
      await context.queryClient.ensureQueryData({
        queryKey: adminActivitySourcesQueryKey,
        queryFn: () => context.apiClient.listActivitySourcesForReview({}),
        staleTime: 30_000,
      });
    }
  },
  component: ActivitySourcesPage,
});

function ActivitySourcesPage() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { auth } = Route.useRouteContext();
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

  const { data: sources = [] } = useQuery({
    queryKey: [...activitySourcesQueryKey, auth.user?.id, activeOrganizationId],
    queryFn: () => apiClient.listActivitySources(),
    enabled: Boolean(activeOrganizationId),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.some(({ approvalStatus }) => approvalStatus === "pending") ? 30_000 : false,
  });

  const { data: adminSources = [] } = useQuery({
    queryKey: adminActivitySourcesQueryKey,
    queryFn: () => apiClient.listActivitySourcesForReview({}),
    enabled: auth.isAdmin,
    staleTime: 30_000,
  });

  const createSource = useMutation({
    mutationFn: (input: CreateActivitySourceInput) => apiClient.createActivitySource(input),
    onSuccess: async () => {
      toast.success("Activity Source registered for review");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activitySourcesQueryKey }),
        queryClient.invalidateQueries({ queryKey: adminActivitySourcesQueryKey }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to register Activity Source");
    },
  });

  const reviewSource = useMutation({
    mutationFn: (input: ReviewActivitySourceInput) => apiClient.reviewActivitySource(input),
    onSuccess: async (source) => {
      toast.success(
        source.approvalStatus === "approved"
          ? "Activity Source approved"
          : "Activity Source rejected",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activitySourcesQueryKey }),
        queryClient.invalidateQueries({ queryKey: adminActivitySourcesQueryKey }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to review Activity Source");
    },
  });

  const updateTrust = useMutation({
    mutationFn: (input: UpdateActivitySourceTrustInput) =>
      apiClient.updateActivitySourceTrust(input),
    onSuccess: async () => {
      toast.success("Activity Source trust updated");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activitySourcesQueryKey }),
        queryClient.invalidateQueries({ queryKey: adminActivitySourcesQueryKey }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update Activity Source trust");
    },
  });

  const resolvedAccess = getActivitySourceRegistrationAccess({
    activeOrganizationId,
    organizationRole: activeOrganizationRole,
    hasNearAccount,
  });
  const registrationAccess =
    linkedNearAccountsPending && resolvedAccess === "near-required" ? null : resolvedAccess;

  const isOrganizationOwner = Boolean(activeOrganizationId) && activeOrganizationRole === "owner";
  const setupSource = isOrganizationOwner ? pickOnboardingSource(sources) : null;
  const setupCredentialsEnabled = setupSource?.approvalStatus === "approved";
  const setup = useActivitySourceCredentials(setupSource, setupCredentialsEnabled);
  const steps = getActivityOnboardingSteps({
    hasNearAccount,
    isOrganizationOwner,
    source: setupSource,
    identity: setupCredentialsEnabled ? setup.identity : null,
    hasApiKey: setupCredentialsEnabled && setup.hasActiveApiKey,
  });
  const setupComplete = steps.every(({ status }) => status === "complete");
  const setupReady = registrationAccess !== null && !setup.isLoading;
  const currentStep = steps.find(({ status }) => status !== "complete");
  const signedInNearAccountId =
    linkedNearAccounts?.find((account) => account.isPrimary)?.accountId ??
    linkedNearAccounts?.[0]?.accountId ??
    null;
  const defaultNearAccountId = signedInNearAccountId ?? nearState?.accountId ?? "";

  const registrationForm = (
    <ActivitySourceRegistration
      access="allowed"
      embedded
      defaultNearAccountId={defaultNearAccountId}
      isSubmitting={createSource.isPending}
      onCreate={async (input) => {
        await createSource.mutateAsync(input);
      }}
    />
  );

  const renderSetupAction = () => {
    if (!currentStep || !registrationAccess) return null;
    switch (currentStep.id) {
      case "near":
      case "organization":
        return <ActivitySourceRegistrationAction access={registrationAccess} />;
      case "register":
        return registrationForm;
      case "approval":
        if (currentStep.status === "blocked") {
          return (
            <div className="space-y-4">
              {setupSource?.reviewReason && (
                <p className="text-sm text-foreground">Reviewer: {setupSource.reviewReason}</p>
              )}
              {registrationForm}
            </div>
          );
        }
        return (
          <p className="font-mono text-xs text-muted-foreground">
            Submitted: {setupSource?.sourceId} · {setupSource?.nearAccountId}
          </p>
        );
      case "binding":
        return (
          <ActivityLinkOnChainAction
            requiredAccountId={setupSource?.nearAccountId ?? ""}
            signedInAccountId={signedInNearAccountId}
            isLinking={setup.linkOnChain.isPending}
            isChecking={setup.confirmBinding.isPending}
            canCheck={setup.identity !== null}
            onLink={() => setup.linkOnChain.mutate()}
            onCheck={() => setup.confirmBinding.mutate()}
          />
        );
      case "api-key":
        return (
          <ActivityApiKeyAction
            isSubmitting={setup.createApiKey.isPending}
            onCreate={(name) => setup.createApiKey.mutate(name)}
          />
        );
    }
  };

  return (
    <PageContainer variant="wide">
      <ActivitySourcesDashboard
        sources={sources}
        reviewQueue={adminSources.filter(({ approvalStatus }) => approvalStatus === "pending")}
        adminSources={adminSources}
        isAdmin={auth.isAdmin}
        registrationAccess={registrationAccess}
        showRegistration={setupComplete}
        onboarding={
          setupReady ? (
            <ActivityOnboardingProgress
              steps={steps}
              nearAccountId={setupSource?.nearAccountId ?? null}
              action={renderSetupAction()}
              complete={
                setupSource ? (
                  <ActivitySetupComplete
                    revealedSecret={setup.revealedApiKey?.secret ?? null}
                    eventType={setupSource.eventTypes.find(({ enabled }) => enabled)?.name ?? null}
                    actor={setupSource.nearAccountId}
                    onDismiss={setup.dismissRevealedApiKey}
                  />
                ) : null
              }
            />
          ) : null
        }
        registrationAction={
          registrationAccess ? (
            <ActivitySourceRegistrationAction access={registrationAccess} />
          ) : null
        }
        isSubmitting={createSource.isPending || reviewSource.isPending || updateTrust.isPending}
        onCreate={async (input) => {
          await createSource.mutateAsync(input);
        }}
        onReview={async (input) => {
          await reviewSource.mutateAsync(input);
        }}
        onTrust={async (input) => {
          await updateTrust.mutateAsync(input);
        }}
        renderCredentials={(source) =>
          source.approvalStatus === "approved" &&
          isOrganizationOwner &&
          (setupComplete || source.sourceId !== setupSource?.sourceId) ? (
            <>
              <ActivityCredentialsManager source={source} />
              <ActivityGithubManager sourceId={source.sourceId} />
            </>
          ) : null
        }
      />
    </PageContainer>
  );
}

function ActivityGithubManager({ sourceId }: { sourceId: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { data: configuration = null, isLoading } = useQuery({
    queryKey: githubQueryKey(sourceId),
    queryFn: () => apiClient.getActivityGithubIntegration({ sourceId }),
  });

  const saveConfiguration = useMutation({
    mutationFn: (input: ActivityGithubConfigurationInput) =>
      apiClient.configureActivityGithubIntegration({ sourceId, ...input }),
    onSuccess: async () => {
      toast.success("GitHub polling settings saved");
      await queryClient.invalidateQueries({ queryKey: githubQueryKey(sourceId) });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Failed to save GitHub polling settings"),
  });

  const poll = useMutation({
    mutationFn: () => apiClient.pollActivityGithubIntegration({ sourceId }),
    onSuccess: async (result) => {
      toast.success("GitHub poll completed", {
        description: `${result.published} published, ${result.quarantined} quarantined, ${result.failed} failed`,
      });
      await queryClient.invalidateQueries({ queryKey: githubQueryKey(sourceId) });
    },
    onError: (error: Error) => toast.error(error.message || "GitHub poll failed"),
  });

  return (
    <ActivityGithubIntegration
      sourceId={sourceId}
      configuration={configuration}
      isLoading={isLoading}
      isSubmitting={saveConfiguration.isPending || poll.isPending}
      onSave={async (input) => {
        await saveConfiguration.mutateAsync(input);
      }}
      onPoll={async () => {
        await poll.mutateAsync();
      }}
    />
  );
}

function ActivityCredentialsManager({ source }: { source: ActivitySourceView }) {
  const credentials = useActivitySourceCredentials(source, true);

  return (
    <ActivitySourceCredentials
      sourceId={source.sourceId}
      nearAccountId={source.nearAccountId}
      identity={credentials.identity}
      apiKeys={credentials.apiKeys}
      revealedApiKey={credentials.revealedApiKey}
      isSubmitting={credentials.isSubmitting}
      onCreateIdentity={async () => {
        await credentials.createIdentity.mutateAsync();
      }}
      onBind={async () => {
        await credentials.bindIdentity.mutateAsync();
      }}
      onConfirmBinding={async () => {
        await credentials.confirmBinding.mutateAsync();
      }}
      onRotate={async () => {
        await credentials.rotateIdentity.mutateAsync();
      }}
      onCreateApiKey={async (name) => {
        await credentials.createApiKey.mutateAsync(name);
      }}
      onRevokeApiKey={async (apiKeyId) => {
        await credentials.revokeApiKey.mutateAsync(apiKeyId);
      }}
      onDismissReveal={credentials.dismissRevealedApiKey}
    />
  );
}
