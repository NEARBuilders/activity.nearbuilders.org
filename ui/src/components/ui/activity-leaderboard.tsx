import { CaretDownIcon as CaretDown, WarningIcon } from "@phosphor-icons/react/ssr";
import type { ApiClient } from "@/app";
import { ActivityTrustBadge } from "@/components/ui/activity-trust-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, getInitials } from "@/lib/utils";

type GetActivityLeaderboard = ApiClient["getActivityLeaderboard"];

export type ActivityLeaderboardPeriod = NonNullable<
  Parameters<GetActivityLeaderboard>[0]["period"]
>;

export type ActivityLeaderboardView = Awaited<ReturnType<GetActivityLeaderboard>>;

type ActivityLeaderboardProps = {
  period: ActivityLeaderboardPeriod;
  result?: ActivityLeaderboardView;
  status: "loading" | "success" | "error";
  errorMessage?: string;
  onPeriodChange: (period: ActivityLeaderboardPeriod) => void;
  onRetry: () => void;
};

const PERIODS: Array<{ value: ActivityLeaderboardPeriod; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "all-time", label: "All time" },
];

export function ActivityLeaderboard({
  period,
  result,
  status,
  errorMessage,
  onPeriodChange,
  onRetry,
}: ActivityLeaderboardProps) {
  return (
    <section className="space-y-4" aria-labelledby="activity-leaderboard-title">
      <div className="flex flex-col gap-3">
        <h2 id="activity-leaderboard-title" className="text-base font-semibold">
          Leaderboard
        </h2>
        <fieldset className="flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
          <legend className="sr-only">Leaderboard period</legend>
          {PERIODS.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={period === value ? "secondary" : "ghost"}
              className={cn(
                "min-w-0 flex-1 px-2 shadow-none",
                period === value ? "shadow-elevation-sm" : "hover:bg-transparent",
              )}
              aria-pressed={period === value}
              onClick={() => onPeriodChange(value)}
            >
              {label}
            </Button>
          ))}
        </fieldset>
      </div>

      {status === "loading" ? (
        <div
          role="status"
          aria-live="polite"
          className="space-y-3 rounded-xl border border-border p-4"
        >
          <p className="text-sm text-muted-foreground">Loading leaderboard…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : status === "error" ? (
        <div role="alert" className="rounded-xl border border-border p-8 text-center text-sm">
          <WarningIcon className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-3 font-semibold text-foreground">Could not load leaderboard</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {errorMessage || "The leaderboard projection is temporarily unavailable."}
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : !result || result.data.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-border p-8 text-center text-sm"
        >
          <p className="font-semibold text-foreground">No ranked activity yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Scores appear after Activity Sources publish events in this period.
          </p>
        </div>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ol className="divide-y divide-border" aria-label="Activity leaderboard rankings">
            {result.data.map((entry) => (
              <li key={entry.actor}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                    <ActivityRankBadge rank={entry.rank} />
                    <Avatar className="size-9">
                      <AvatarFallback className="text-xs">
                        {getInitials(entry.actor)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{entry.actor}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.eventCount} {entry.eventCount === 1 ? "event" : "events"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold leading-none tabular-nums text-foreground">
                        {entry.score}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.score === 1 ? "point" : "points"}
                      </p>
                    </div>
                    <CaretDown
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    />
                    <span className="sr-only">Show score breakdown</span>
                  </summary>
                  <div className="px-4 pb-4">
                    <ul
                      className="divide-y divide-border rounded-lg border border-border bg-muted/30"
                      aria-label={`${entry.actor} score breakdown`}
                    >
                      {entry.breakdown.map((item) => (
                        <li
                          key={`${item.source}:${item.type}`}
                          className="flex items-center justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm text-foreground">
                                {item.sourceDisplayName}
                              </span>
                              <ActivityTrustBadge
                                trustStatus={item.trustStatus}
                                scoreMultiplier={item.scoreMultiplier}
                              />
                            </div>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {item.type}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums text-foreground">
                              +{item.score}
                            </p>
                            <p className="text-xs tabular-nums text-muted-foreground">
                              {item.eventCount} × {item.pointValue}
                              {item.scoreMultiplier !== 1 && ` × ${item.scoreMultiplier}`}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </section>
  );
}

export function ActivityRankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        rank <= 3 ? "bg-brand-accent text-brand-accent-foreground" : "text-muted-foreground",
      )}
    >
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}
