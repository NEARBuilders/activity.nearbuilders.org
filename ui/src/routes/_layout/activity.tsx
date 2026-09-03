import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ActivityFeed, type ActivityFeedFilters } from "@/components/activity-feed";
import { PageContainer } from "@/components/layout/page-container";
import { useApiClient } from "@/lib/api";

type ActivityFeedSearch = {
  source?: string;
  type?: string;
  actor?: string;
};

export const Route = createFileRoute("/_layout/activity")({
  validateSearch: (search: Record<string, unknown>): ActivityFeedSearch => ({
    source: stringSearchValue(search.source),
    type: stringSearchValue(search.type),
    actor: stringSearchValue(search.actor),
  }),
  head: () => ({
    meta: [
      { title: "Activity feed | NEAR Builders" },
      {
        name: "description",
        content: "Browse trusted Activity events published by registered NEAR Builders sources.",
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
  const cursor = cursors.at(-1);
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

  const applyFilters = (filters: ActivityFeedFilters) => {
    setCursors([undefined]);
    void navigate({ search: filters });
  };

  return (
    <PageContainer variant="wide">
      <ActivityFeed
        events={query.data?.data ?? []}
        filters={search}
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
    </PageContainer>
  );
}

function stringSearchValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
