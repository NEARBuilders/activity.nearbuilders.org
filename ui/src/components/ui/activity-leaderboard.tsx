import { WarningIcon } from "@phosphor-icons/react/ssr";
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
              <li key={entry.actor} className="p-4">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>{getInitials(entry.actor)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.actor}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.eventCount} {entry.eventCount === 1 ? "event" : "events"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {entry.score} {entry.score === 1 ? "point" : "points"}
                  </span>
                </div>
                <details className="mt-2 ml-11 text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    Score breakdown
                  </summary>
                  <ul className="mt-3 space-y-3" aria-label={`${entry.actor} score breakdown`}>
                    {entry.breakdown.map((item) => (
                      <li key={`${item.source}:${item.type}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{item.sourceDisplayName}</span>
                          <ActivityTrustBadge
                            trustStatus={item.trustStatus}
                            scoreMultiplier={item.scoreMultiplier}
                          />
                        </div>
                        <div className="mt-1">
                          {item.type}
                          {` · ${item.eventCount} × ${item.pointValue} × ${item.scoreMultiplier} · ${item.score} points`}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </section>
  );
}
