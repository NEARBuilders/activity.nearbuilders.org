import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useApiClient } from "@/app";
import { ActivityLeaderboard, type ActivityLeaderboardPeriod } from "@/components";
import { ActivityFeed } from "@/components/activity-feed";
import { PageContainer } from "@/components/layout/page-container";
import { useActivityFeed } from "@/hooks/use-activity-feed";
import { activityFeedOptions, activityLeaderboardOptions } from "@/lib/activity-queries";

type ActivityFeedSearch = {
  source?: string;
  type?: string;
  actor?: string;
  period?: ActivityLeaderboardPeriod;
};

export const Route = createFileRoute("/_layout/activity")({
  validateSearch: (search: Record<string, unknown>): ActivityFeedSearch => ({
    source: stringSearchValue(search.source),
    type: stringSearchValue(search.type),
    actor: stringSearchValue(search.actor),
    period: periodSearchValue(search.period),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(activityFeedOptions(context.apiClient, deps)),
      context.queryClient.prefetchQuery(
        activityLeaderboardOptions(context.apiClient, deps, deps.period),
      ),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Activity leaderboard and feed | NEAR Builders" },
      {
        name: "description",
        content: "Rank NEAR actors and browse trusted events from registered Activity Sources.",
      },
    ],
  }),
  component: ActivityFeedPage,
});

function ActivityFeedPage() {
  const search = Route.useSearch();
  const filterKey = JSON.stringify([search.source, search.type, search.actor]);
  return <ActivityFeedPageContent key={filterKey} search={search} />;
}

function ActivityFeedPageContent({ search }: { search: ActivityFeedSearch }) {
  const apiClient = useApiClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const period = search.period ?? "weekly";
  const feed = useActivityFeed(
    search,
    (filters) => void navigate({ search: { ...filters, period: search.period } }),
  );
  const leaderboardQuery = useQuery(activityLeaderboardOptions(apiClient, search, period));
  return (
    <PageContainer variant="wide">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ActivityFeed {...feed} />
        <ActivityLeaderboard
          period={period}
          result={leaderboardQuery.data}
          status={
            leaderboardQuery.isError ? "error" : leaderboardQuery.isPending ? "loading" : "success"
          }
          errorMessage={
            leaderboardQuery.error instanceof Error ? leaderboardQuery.error.message : undefined
          }
          onPeriodChange={(period) => void navigate({ search: { ...search, period } })}
          onRetry={() => void leaderboardQuery.refetch()}
        />
      </div>
    </PageContainer>
  );
}

function stringSearchValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function periodSearchValue(value: unknown): ActivityLeaderboardPeriod | undefined {
  return value === "weekly" || value === "monthly" || value === "all-time" ? value : undefined;
}
