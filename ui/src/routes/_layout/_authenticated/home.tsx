import { ArrowRightIcon, BroadcastIcon, BuildingsIcon, GearIcon } from "@phosphor-icons/react/ssr";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { ActivityTimestamp } from "@/components/activity-timestamp";
import { PageContainer } from "@/components/layout/page-container";
import { ActivityRankBadge } from "@/components/ui/activity-leaderboard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { activityFeedOptions, activityLeaderboardOptions } from "@/lib/activity-queries";
import { getInitials } from "@/lib/utils";

export const Route = createFileRoute("/_layout/_authenticated/home")({
  head: () => ({ meta: [{ title: "Overview | NEAR Builders Activity" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(activityFeedOptions(context.apiClient, {})),
      context.queryClient.prefetchQuery(activityLeaderboardOptions(context.apiClient, {})),
    ]);
  },
  component: Home,
});

function Home() {
  const auth = useAuthClient();
  const api = useApiClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const feed = useQuery(activityFeedOptions(api, {}));
  const leaderboard = useQuery(activityLeaderboardOptions(api, {}));
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await auth.organization.list();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const activeOrg = organizations.data?.find(
    (org) => org.id === session?.session.activeOrganizationId,
  );
  return (
    <PageContainer variant="wide">
      <header className="mb-8 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        {session?.user.name && (
          <p className="text-sm text-muted-foreground">Welcome back, {session.user.name}</p>
        )}
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <section className="min-w-0 space-y-3" aria-labelledby="recent-activity">
          <div className="flex items-center justify-between gap-4">
            <h2 id="recent-activity" className="text-base font-semibold">
              Recent activity
            </h2>
            <Link
              to="/activity"
              className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              View feed <ArrowRightIcon aria-hidden="true" />
            </Link>
          </div>
          {feed.isPending ? (
            <div role="status" aria-live="polite" className="space-y-4 py-4">
              <span className="sr-only">Loading activity…</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 py-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                </div>
              ))}
            </div>
          ) : feed.isError ? (
            <div className="py-6" role="alert">
              <p className="text-sm text-muted-foreground">Activity could not be loaded.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void feed.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : !feed.data?.data.length ? (
            <p className="py-6 text-sm text-muted-foreground">
              No activity yet. Connect a source to start publishing.
            </p>
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <ol className="divide-y divide-border">
                {feed.data.data.slice(0, 6).map((event) => (
                  <li key={event.id} className="flex gap-3 px-4 py-3.5">
                    <Avatar className="size-9">
                      <AvatarFallback className="text-xs">
                        {getInitials(event.actor)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium">{event.actor}</span>
                        <ActivityTimestamp value={event.timestamp} className="shrink-0" />
                      </div>
                      <p className="text-sm text-foreground">
                        {eventTitle(event.payload, event.type)}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{event.provenance.sourceDisplayName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{event.type}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </section>
        <aside className="space-y-6">
          <Card className="gap-3 p-4">
            <div className="px-1">
              <p className="text-xs text-muted-foreground">Workspace</p>
              <h2 className="truncate text-base font-semibold">
                {activeOrg?.name ?? "Your workspace"}
              </h2>
            </div>
            <nav className="flex flex-col gap-1 -mx-2" aria-label="Workspace actions">
              <Button asChild variant="ghost" className="justify-start">
                <Link to="/activity-sources">
                  <BroadcastIcon aria-hidden="true" />
                  Manage sources
                  <ArrowRightIcon aria-hidden="true" className="ml-auto" />
                </Link>
              </Button>
              <Button asChild variant="ghost" className="justify-start">
                <Link to="/organizations">
                  <BuildingsIcon aria-hidden="true" />
                  Workspaces
                  <ArrowRightIcon aria-hidden="true" className="ml-auto" />
                </Link>
              </Button>
              <Button asChild variant="ghost" className="justify-start">
                <Link to="/settings">
                  <GearIcon aria-hidden="true" />
                  Account settings
                  <ArrowRightIcon aria-hidden="true" className="ml-auto" />
                </Link>
              </Button>
            </nav>
          </Card>
          <section className="space-y-3" aria-labelledby="weekly-builders">
            <div className="flex items-center justify-between gap-4">
              <h2 id="weekly-builders" className="text-base font-semibold">
                Leading this week
              </h2>
              <Link
                to="/activity"
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
              >
                View all <ArrowRightIcon aria-hidden="true" />
              </Link>
            </div>
            {leaderboard.isPending ? (
              <div role="status" aria-live="polite" className="space-y-3 py-4">
                <span className="sr-only">Loading rankings…</span>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-3.5 flex-1" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                ))}
              </div>
            ) : leaderboard.isError ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => void leaderboard.refetch()}
              >
                Retry rankings
              </Button>
            ) : !leaderboard.data?.data.length ? (
              <p className="py-4 text-xs text-muted-foreground">No contributions this week.</p>
            ) : (
              <Card className="gap-0 overflow-hidden py-0">
                <ol className="divide-y divide-border">
                  {leaderboard.data.data.slice(0, 5).map((entry) => (
                    <li key={entry.actor} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <ActivityRankBadge rank={entry.rank} />
                      <Avatar className="size-7">
                        <AvatarFallback className="text-[10px]">
                          {getInitials(entry.actor)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate">{entry.actor}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {entry.score}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}

function eventTitle(payload: unknown, type: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "title" in payload &&
    typeof payload.title === "string"
  )
    return payload.title;
  return type.replaceAll(/[._]/g, " ");
}
