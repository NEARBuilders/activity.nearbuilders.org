import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useApiClient, useAuthClient } from "@/app";
import { ActivitySourceCredentials } from "@/components/activity-source-credentials";
import {
  ActivitySourcesDashboard,
  type ActivitySourceView,
  type CreateActivitySourceInput,
  type ReviewActivitySourceInput,
  type UpdateActivitySourceTrustInput,
} from "@/components/activity-sources-dashboard";
import { PageContainer } from "@/components/layout/page-container";
import {
  createActivityBindingWallet,
  submitActivityBindingTransaction,
} from "@/lib/activity-binding-transaction";
import { getActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

const activitySourcesQueryKey = ["activity-sources"] as const;
const adminActivitySourcesQueryKey = ["activity-source-reviews", "all"] as const;

function credentialQueryKey(sourceId: string) {
  return ["activity-source-credentials", sourceId] as const;
}

function apiKeysQueryKey(sourceId: string) {
  return ["activity-source-api-keys", sourceId] as const;
}

export const Route = createFileRoute("/_layout/_authenticated/activity-sources")({
  head: () => ({
    meta: [{ title: "Activity Sources | NEAR Builders" }],
  }),
  loader: async ({ context }) => {
    if (context.auth.activeOrganizationId) {
      await context.queryClient.ensureQueryData({
        queryKey: activitySourcesQueryKey,
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
  const queryClient = useQueryClient();
  const { auth } = Route.useRouteContext();

  const { data: sources = [] } = useQuery({
    queryKey: activitySourcesQueryKey,
    queryFn: () => apiClient.listActivitySources(),
    enabled: Boolean(auth.activeOrganizationId),
    staleTime: 30_000,
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

  return (
    <PageContainer variant="wide">
      <ActivitySourcesDashboard
        sources={sources}
        reviewQueue={adminSources.filter(({ approvalStatus }) => approvalStatus === "pending")}
        adminSources={adminSources}
        isAdmin={auth.isAdmin}
        registrationAccess={getActivitySourceRegistrationAccess({
          activeOrganizationId: auth.activeOrganizationId,
          organizationRole: auth.activeOrganizationRole,
          hasNearAccount: auth.hasNearAccount,
        })}
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
          source.approvalStatus === "approved" && auth.activeOrganizationRole === "owner" ? (
            <ActivityCredentialsManager source={source} />
          ) : null
        }
      />
    </PageContainer>
  );
}

function ActivityCredentialsManager({ source }: { source: ActivitySourceView }) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const [revealedApiKey, setRevealedApiKey] = useState<{
    secret: string;
    apiKeyId: string;
  } | null>(null);

  const { data: identity = null } = useQuery({
    queryKey: credentialQueryKey(source.sourceId),
    queryFn: () => apiClient.getActivitySigningIdentity({ sourceId: source.sourceId }),
  });
  const { data: apiKeys = [] } = useQuery({
    queryKey: apiKeysQueryKey(source.sourceId),
    queryFn: () => apiClient.listActivitySourceApiKeys({ sourceId: source.sourceId }),
  });

  const refreshCredentials = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: credentialQueryKey(source.sourceId) }),
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(source.sourceId) }),
    ]);
  };

  const createIdentity = useMutation({
    mutationFn: () => apiClient.createActivitySigningIdentity({ sourceId: source.sourceId }),
    onSuccess: async () => {
      toast.success("Signing Identity created");
      await refreshCredentials();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create Signing Identity"),
  });

  const bindIdentity = useMutation({
    mutationFn: async () => {
      const prepared = await apiClient.prepareActivitySigningIdentityBinding({
        sourceId: source.sourceId,
      });
      return submitActivityBindingTransaction({
        wallet: createActivityBindingWallet(authClient.near),
        nearAccountId: source.nearAccountId,
        binding: prepared,
      });
    },
    onSuccess: (result) => {
      toast.success("Binding transaction submitted", {
        description: result?.txHash
          ? `Transaction ${result.txHash}. Check the binding after it is indexed.`
          : "Check the binding after it is indexed.",
      });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to authorize binding"),
  });

  const confirmBinding = useMutation({
    mutationFn: () =>
      apiClient.confirmActivitySigningIdentityBinding({ sourceId: source.sourceId }),
    onSuccess: async () => {
      toast.success("NEAR-to-Nostr binding confirmed");
      await refreshCredentials();
    },
    onError: (error: Error) =>
      toast.error(error.message || "Binding is not indexed yet. Try again shortly."),
  });

  const rotateIdentity = useMutation({
    mutationFn: () => apiClient.rotateActivitySigningIdentity({ sourceId: source.sourceId }),
    onSuccess: async () => {
      setRevealedApiKey(null);
      toast.success("Signing Identity rotated", {
        description: "Authorize the new public key with the Activity Source NEAR account.",
      });
      await refreshCredentials();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to rotate Signing Identity"),
  });

  const createApiKey = useMutation({
    mutationFn: (name: string) =>
      apiClient.createActivitySourceApiKey({ sourceId: source.sourceId, name }),
    onSuccess: async ({ secret, apiKey }) => {
      setRevealedApiKey({ secret, apiKeyId: apiKey.id });
      toast.success("Source API Key created");
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(source.sourceId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create Source API Key"),
  });

  const revokeApiKey = useMutation({
    mutationFn: (apiKeyId: string) =>
      apiClient.revokeActivitySourceApiKey({ sourceId: source.sourceId, apiKeyId }),
    onSuccess: async ({ id }) => {
      if (revealedApiKey?.apiKeyId === id) setRevealedApiKey(null);
      toast.success("Source API Key revoked");
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(source.sourceId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to revoke Source API Key"),
  });

  const isSubmitting =
    createIdentity.isPending ||
    bindIdentity.isPending ||
    confirmBinding.isPending ||
    rotateIdentity.isPending ||
    createApiKey.isPending ||
    revokeApiKey.isPending;

  return (
    <ActivitySourceCredentials
      sourceId={source.sourceId}
      nearAccountId={source.nearAccountId}
      identity={identity}
      apiKeys={apiKeys}
      revealedApiKey={revealedApiKey}
      isSubmitting={isSubmitting}
      onCreateIdentity={async () => {
        await createIdentity.mutateAsync();
      }}
      onBind={async () => {
        await bindIdentity.mutateAsync();
      }}
      onConfirmBinding={async () => {
        await confirmBinding.mutateAsync();
      }}
      onRotate={async () => {
        await rotateIdentity.mutateAsync();
      }}
      onCreateApiKey={async (name) => {
        await createApiKey.mutateAsync(name);
      }}
      onRevokeApiKey={async (apiKeyId) => {
        await revokeApiKey.mutateAsync(apiKeyId);
      }}
      onDismissReveal={() => setRevealedApiKey(null)}
    />
  );
}
