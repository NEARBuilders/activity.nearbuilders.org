import { AlertTriangle, Trophy } from "lucide-react";
import type { ApiClient } from "@/app";
import { ActivityTrustBadge } from "@/components/ui/activity-trust-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" />
            Dynamically weighted
          </div>
          <h2 id="activity-leaderboard-title" className="text-2xl font-bold text-foreground">
            Leaderboard
          </h2>
          <p className="text-sm text-muted-foreground">{periodDescription(result)}</p>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Leaderboard period</legend>
          {PERIODS.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={period === value ? "default" : "outline"}
              aria-pressed={period === value}
              onClick={() => onPeriodChange(value)}
            >
              {label}
            </Button>
          ))}
        </fieldset>
      </div>

      {status === "loading" ? (
        <Card role="status" aria-live="polite" className="p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading leaderboard…</p>
        </Card>
      ) : status === "error" ? (
        <Card role="alert" className="p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-3 font-semibold text-foreground">Could not load leaderboard</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {errorMessage || "The leaderboard projection is temporarily unavailable."}
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        </Card>
      ) : !result || result.data.length === 0 ? (
        <Card role="status" className="p-8 text-center">
          <p className="font-semibold text-foreground">No ranked activity yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Scores appear after Activity Sources publish events in this period.
          </p>
        </Card>
      ) : (
        <ol className="grid gap-3" aria-label="Activity leaderboard rankings">
          {result.data.map((entry) => (
            <li key={entry.actor}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
                        {entry.rank}
                      </span>
                      <div>
                        <CardTitle className="text-base">{entry.actor}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.eventCount} {entry.eventCount === 1 ? "event" : "events"}
                        </p>
                      </div>
                    </div>
                    <p className="text-lg font-bold text-foreground">
                      {entry.score} {entry.score === 1 ? "point" : "points"}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul
                    className="flex flex-wrap gap-2"
                    aria-label={`${entry.actor} score breakdown`}
                  >
                    {entry.breakdown.map((item) => (
                      <li
                        key={`${item.source}:${item.type}`}
                        className="rounded-[8px] border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {item.sourceDisplayName}
                          </span>
                          <ActivityTrustBadge
                            trustStatus={item.trustStatus}
                            scoreMultiplier={item.scoreMultiplier}
                          />
                        </div>
                        <div className="mt-1">
                          <span className="font-mono text-foreground">{item.type}</span>
                          {` · ${item.eventCount} × ${item.pointValue} × ${item.scoreMultiplier} · ${item.score} points`}
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function periodDescription(result?: ActivityLeaderboardView): string {
  if (!result?.startsAt || !result.endsAt) return "All signature-verified Activity events";
  const startsAt = new Date(result.startsAt).toLocaleDateString(undefined, { timeZone: "UTC" });
  const endsAt = new Date(new Date(result.endsAt).getTime() - 1).toLocaleDateString(undefined, {
    timeZone: "UTC",
  });
  return `${startsAt} – ${endsAt} · UTC`;
}
