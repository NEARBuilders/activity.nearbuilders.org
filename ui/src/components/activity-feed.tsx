import { AlertTriangle, Clock3, RadioTower } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ActivityFeedEventView = {
  id: string;
  source: string;
  type: string;
  actor: string;
  idempotencyKey: string;
  timestamp: string;
  payload: unknown;
};

export type ActivityFeedFilters = {
  source?: string;
  type?: string;
  actor?: string;
};

type ActivityFeedProps = {
  events: ActivityFeedEventView[];
  filters?: ActivityFeedFilters;
  liveStatus?: "connecting" | "live" | "unavailable";
  status: "loading" | "success" | "error";
  errorMessage?: string;
  skippedInvalid: number;
  hasMore: boolean;
  canGoBack?: boolean;
  onApplyFilters: (filters: ActivityFeedFilters) => void;
  onNextPage: () => void;
  onPreviousPage?: () => void;
  onRetry: () => void;
};

export function ActivityFeed({
  events,
  filters = {},
  liveStatus,
  status,
  errorMessage,
  skippedInvalid,
  hasMore,
  canGoBack = false,
  onApplyFilters,
  onNextPage,
  onPreviousPage,
  onRetry,
}: ActivityFeedProps) {
  const [source, setSource] = useState(filters.source ?? "");
  const [type, setType] = useState(filters.type ?? "");
  const [actor, setActor] = useState(filters.actor ?? "");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <RadioTower className="h-3.5 w-3.5" />
          Public protocol data
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Activity feed
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Browse signed Activity events from registered Activity Sources.
        </p>
        {liveStatus && (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {liveStatus === "live"
              ? "Live updates connected"
              : liveStatus === "connecting"
                ? "Connecting live updates…"
                : "Live updates unavailable; paginated events are still available"}
          </p>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filter events</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-3"
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              onApplyFilters({
                source: source.trim() || undefined,
                type: type.trim() || undefined,
                actor: actor.trim() || undefined,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="activity-source-filter">Activity Source</Label>
              <Input
                id="activity-source-filter"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="feedback-rounds"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activity-type-filter">Event type</Label>
              <Input
                id="activity-type-filter"
                value={type}
                onChange={(event) => setType(event.target.value)}
                placeholder="feedback.submitted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activity-actor-filter">NEAR actor</Label>
              <Input
                id="activity-actor-filter"
                value={actor}
                onChange={(event) => setActor(event.target.value)}
                placeholder="alice.near"
              />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-3">
              <Button type="submit">Apply filters</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSource("");
                  setType("");
                  setActor("");
                  onApplyFilters({});
                }}
              >
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {status === "loading" ? (
        <Card role="status" aria-live="polite" className="p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading Activity events…</p>
        </Card>
      ) : status === "error" ? (
        <Card role="alert" className="p-8 text-center">
          <div className="space-y-4">
            <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
            <div>
              <p className="font-semibold text-foreground">Could not load Activity events</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {errorMessage || "The Activity feed is temporarily unavailable."}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {skippedInvalid > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-[10px] border border-border bg-muted p-3 text-sm text-muted-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {skippedInvalid} invalid relay {skippedInvalid === 1 ? "event was" : "events were"}{" "}
                omitted.
              </span>
            </div>
          )}

          {events.length === 0 ? (
            <Card role="status" className="p-8 text-center">
              <p className="font-semibold text-foreground">No Activity events found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try clearing or changing the current filters.
              </p>
            </Card>
          ) : (
            <ol className="space-y-3" aria-label="Activity events">
              {events.map((event) => (
                <li key={event.id}>
                  <Card>
                    <CardContent className="space-y-4 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground">{event.actor}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-mono">{event.type}</span>
                            <span>from {event.source}</span>
                          </div>
                        </div>
                        <time
                          dateTime={event.timestamp}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(event.timestamp).toLocaleString()}
                        </time>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[8px] border border-border bg-muted p-3 text-xs text-foreground">
                        {payloadSummary(event.payload)}
                      </pre>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ol>
          )}

          {(canGoBack || hasMore) && (
            <nav aria-label="Activity feed pages" className="flex justify-end gap-2">
              {canGoBack && onPreviousPage && (
                <Button type="button" variant="outline" onClick={onPreviousPage}>
                  Previous page
                </Button>
              )}
              {hasMore && (
                <Button type="button" variant="outline" onClick={onNextPage}>
                  Next page
                </Button>
              )}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function payloadSummary(payload: unknown): string {
  const summary = JSON.stringify(payload, null, 2) ?? String(payload);
  return summary.length > 500 ? `${summary.slice(0, 497)}…` : summary;
}
