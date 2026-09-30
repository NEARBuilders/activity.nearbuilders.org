import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useApiClient, useAuthClient } from "@/app";
import {
  createActivityBindingWallet,
  submitActivityBindingTransaction,
} from "@/lib/activity-binding-transaction";

const BINDING_POLL_INTERVAL_MS = 2000;
const BINDING_POLL_ATTEMPTS = 15;

export function credentialQueryKey(sourceId: string) {
  return ["activity-source-credentials", sourceId] as const;
}

export function apiKeysQueryKey(sourceId: string) {
  return ["activity-source-api-keys", sourceId] as const;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useActivitySourceCredentials(
  source: { sourceId: string; nearAccountId: string } | null,
  enabled: boolean,
) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const sourceId = source?.sourceId ?? "";
  const [revealedApiKey, setRevealedApiKey] = useState<{
    secret: string;
    apiKeyId: string;
  } | null>(null);

  const identityQuery = useQuery({
    queryKey: credentialQueryKey(sourceId),
    queryFn: () => apiClient.getActivitySigningIdentity({ sourceId }),
    enabled: enabled && Boolean(source),
  });
  const apiKeysQuery = useQuery({
    queryKey: apiKeysQueryKey(sourceId),
    queryFn: () => apiClient.listActivitySourceApiKeys({ sourceId }),
    enabled: enabled && Boolean(source),
  });
  const identity = identityQuery.data ?? null;
  const apiKeys = apiKeysQuery.data ?? [];

  const refreshCredentials = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: credentialQueryKey(sourceId) }),
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(sourceId) }),
    ]);
  };

  const submitBinding = async () => {
    if (!source) throw new Error("Select an Activity Source first");
    const prepared = await apiClient.prepareActivitySigningIdentityBinding({ sourceId });
    return submitActivityBindingTransaction({
      wallet: createActivityBindingWallet(authClient.near),
      nearAccountId: source.nearAccountId,
      binding: prepared,
    });
  };

  const waitForBinding = async () => {
    for (let attempt = 0; attempt < BINDING_POLL_ATTEMPTS; attempt += 1) {
      await wait(BINDING_POLL_INTERVAL_MS);
      try {
        await apiClient.confirmActivitySigningIdentityBinding({ sourceId });
        return;
      } catch {}
    }
    throw new Error(
      "The transaction was sent but is not indexed yet. Use Check again in a moment.",
    );
  };

  const createIdentity = useMutation({
    mutationFn: () => apiClient.createActivitySigningIdentity({ sourceId }),
    onSuccess: async () => {
      toast.success("Signing Identity created");
      await refreshCredentials();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create Signing Identity"),
  });

  const bindIdentity = useMutation({
    mutationFn: submitBinding,
    onSuccess: (result) => {
      toast.success("Binding transaction submitted", {
        description: result?.txHash
          ? `Transaction ${result.txHash}. Check the binding after it is indexed.`
          : "Check the binding after it is indexed.",
      });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to authorize binding"),
  });

  const linkOnChain = useMutation({
    mutationFn: async () => {
      if (!identity) {
        await apiClient.createActivitySigningIdentity({ sourceId });
      }
      await submitBinding();
      await waitForBinding();
    },
    onSuccess: () => toast.success("Linked on-chain"),
    onError: (error: Error) => toast.error(error.message || "Failed to link on-chain"),
    onSettled: refreshCredentials,
  });

  const confirmBinding = useMutation({
    mutationFn: () => apiClient.confirmActivitySigningIdentityBinding({ sourceId }),
    onSuccess: async () => {
      toast.success("NEAR-to-Nostr binding confirmed");
      await refreshCredentials();
    },
    onError: (error: Error) =>
      toast.error(error.message || "Binding is not indexed yet. Try again shortly."),
  });

  const rotateIdentity = useMutation({
    mutationFn: () => apiClient.rotateActivitySigningIdentity({ sourceId }),
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
    mutationFn: (name: string) => apiClient.createActivitySourceApiKey({ sourceId, name }),
    onSuccess: async ({ secret, apiKey }) => {
      setRevealedApiKey({ secret, apiKeyId: apiKey.id });
      toast.success("Source API Key created");
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(sourceId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create Source API Key"),
  });

  const revokeApiKey = useMutation({
    mutationFn: (apiKeyId: string) => apiClient.revokeActivitySourceApiKey({ sourceId, apiKeyId }),
    onSuccess: async ({ id }) => {
      if (revealedApiKey?.apiKeyId === id) setRevealedApiKey(null);
      toast.success("Source API Key revoked");
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(sourceId) });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to revoke Source API Key"),
  });

  return {
    identity,
    apiKeys,
    isLoading: identityQuery.isLoading || apiKeysQuery.isLoading,
    hasActiveApiKey: apiKeys.some((apiKey) => !apiKey.revokedAt),
    revealedApiKey,
    dismissRevealedApiKey: () => setRevealedApiKey(null),
    createIdentity,
    bindIdentity,
    linkOnChain,
    confirmBinding,
    rotateIdentity,
    createApiKey,
    revokeApiKey,
    isSubmitting:
      createIdentity.isPending ||
      bindIdentity.isPending ||
      linkOnChain.isPending ||
      confirmBinding.isPending ||
      rotateIdentity.isPending ||
      createApiKey.isPending ||
      revokeApiKey.isPending,
  };
}
