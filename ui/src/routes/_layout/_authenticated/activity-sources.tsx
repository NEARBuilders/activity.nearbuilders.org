import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import {
  ActivitySourcesDashboard,
  type CreateActivitySourceInput,
  type ReviewActivitySourceInput,
} from "@/components/activity-sources-dashboard";
import { PageContainer } from "@/components/layout/page-container";
import { getActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

const activitySourcesQueryKey = ["activity-sources"] as const;
const sourceReviewQueueQueryKey = ["activity-source-reviews", "pending"] as const;

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
        queryKey: sourceReviewQueueQueryKey,
        queryFn: () =>
          context.apiClient.listActivitySourcesForReview({ approvalStatus: "pending" }),
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

  const { data: reviewQueue = [] } = useQuery({
    queryKey: sourceReviewQueueQueryKey,
    queryFn: () => apiClient.listActivitySourcesForReview({ approvalStatus: "pending" }),
    enabled: auth.isAdmin,
    staleTime: 30_000,
  });

  const createSource = useMutation({
    mutationFn: (input: CreateActivitySourceInput) => apiClient.createActivitySource(input),
    onSuccess: async () => {
      toast.success("Activity Source registered for review");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activitySourcesQueryKey }),
        queryClient.invalidateQueries({ queryKey: sourceReviewQueueQueryKey }),
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
        queryClient.invalidateQueries({ queryKey: sourceReviewQueueQueryKey }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to review Activity Source");
    },
  });

  return (
    <PageContainer variant="wide">
      <ActivitySourcesDashboard
        sources={sources}
        reviewQueue={reviewQueue}
        isAdmin={auth.isAdmin}
        registrationAccess={getActivitySourceRegistrationAccess({
          activeOrganizationId: auth.activeOrganizationId,
          organizationRole: auth.activeOrganizationRole,
          hasNearAccount: auth.hasNearAccount,
        })}
        isSubmitting={createSource.isPending || reviewSource.isPending}
        onCreate={async (input) => {
          await createSource.mutateAsync(input);
        }}
        onReview={async (input) => {
          await reviewSource.mutateAsync(input);
        }}
      />
    </PageContainer>
  );
}
