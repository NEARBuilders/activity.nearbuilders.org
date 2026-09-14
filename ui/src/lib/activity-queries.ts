import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";
import type { ActivityLeaderboardPeriod } from "@/components";
import type { ActivityFeedFilters } from "@/components/activity-feed";

export function activityFeedOptions(
  apiClient: Pick<ApiClient, "listActivityEvents">,
  filters: ActivityFeedFilters,
  cursor?: string,
) {
  return queryOptions({
    queryKey: ["activity-feed", filters.source, filters.type, filters.actor, cursor],
    queryFn: () =>
      apiClient.listActivityEvents({
        source: filters.source,
        type: filters.type,
        actor: filters.actor,
        limit: 20,
        cursor,
      }),
    staleTime: 30_000,
    retry: 1,
  });
}

export function activityLeaderboardOptions(
  apiClient: Pick<ApiClient, "getActivityLeaderboard">,
  filters: ActivityFeedFilters,
  period: ActivityLeaderboardPeriod = "weekly",
) {
  return queryOptions({
    queryKey: ["activity-leaderboard", period, filters.source, filters.type],
    queryFn: () =>
      apiClient.getActivityLeaderboard({
        period,
        source: filters.source,
        type: filters.type,
        limit: 20,
      }),
    staleTime: 30_000,
    retry: 1,
  });
}
