import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApiClient } from "@/app";
import { ActivityLeaderboard, type ActivityLeaderboardPeriod } from "@/components";
import {
  ActivityFeed,
  type ActivityFeedEventView,
  type ActivityFeedFilters,
} from "@/components/activity-feed";
import { PageContainer } from "@/components/layout/page-container";
import { mergeLiveActivityEvent } from "@/lib/activity-feed-live";

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
  const filterKey = `${search.source ?? ""}:${search.type ?? ""}:${search.actor ?? ""}`;
  return <ActivityFeedPageContent key={filterKey} search={search} />;
}

function ActivityFeedPageContent({ search }: { search: ActivityFeedSearch }) {
  const apiClient = useApiClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [liveEvents, setLiveEvents] = useState<ActivityFeedEventView[]>([]);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "unavailable">("connecting");
  const cursor = cursors.at(-1);
  const period = search.period ?? "weekly";
  const leaderboardQuery = useQuery({
    queryKey: ["activity-leaderboard", period, search.source, search.type],
    queryFn: () =>
      apiClient.getActivityLeaderboard({
        period,
        source: search.source,
        type: search.type,
        limit: 20,
      }),
    retry: 1,
  });
  const query = useQuery({
    queryKey: ["activity-feed", search.source, search.type, search.actor, cursor],
    queryFn: () =>
      apiClient.listActivityEvents({
        source: search.source,
        type: search.type,
        actor: search.actor,
        limit: 20,
        cursor,
      }),
    retry: 1,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const consume = async () => {
      try {
        const stream = await apiClient.streamActivityEvents(
          {
            source: search.source,
            type: search.type,
            actor: search.actor,
          },
          { signal: controller.signal },
        );
        if (active) setLiveStatus("live");
        for await (const event of stream) {
          if (!active) break;
          setLiveEvents((current) => mergeLiveActivityEvent(current, event));
        }
      } catch {
        if (active && !controller.signal.aborted) setLiveStatus("unavailable");
      }
    };
    void consume();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiClient, search.actor, search.source, search.type]);

  const applyFilters = (filters: ActivityFeedFilters) => {
    setCursors([undefined]);
    void navigate({ search: { ...filters, period: search.period } });
  };

  const paginatedEvents: ActivityFeedEventView[] = query.data?.data ?? [];
  const events = cursor
    ? paginatedEvents
    : liveEvents.reduceRight(
        (current, event) => mergeLiveActivityEvent(current, event),
        paginatedEvents,
      );

  return (
    <PageContainer variant="wide">
      <div className="space-y-12">
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
        <ActivityFeed
          events={events}
          filters={search}
          liveStatus={liveStatus}
          status={query.isError ? "error" : query.isPending ? "loading" : "success"}
          errorMessage={query.error instanceof Error ? query.error.message : undefined}
          skippedInvalid={query.data?.meta.skippedInvalid ?? 0}
          hasMore={query.data?.meta.hasMore ?? false}
          canGoBack={cursors.length > 1}
          onApplyFilters={applyFilters}
          onNextPage={() => {
            const nextCursor = query.data?.meta.nextCursor;
            if (nextCursor) setCursors((current) => [...current, nextCursor]);
          }}
          onPreviousPage={() => {
            setCursors((current) => (current.length > 1 ? current.slice(0, -1) : current));
          }}
          onRetry={() => void query.refetch()}
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
