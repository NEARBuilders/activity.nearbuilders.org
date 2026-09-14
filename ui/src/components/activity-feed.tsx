import {
  WarningIcon as AlertTriangle,
  ClockIcon as Clock3,
  GitPullRequestIcon as GitPullRequest,
  HeartIcon as Heart,
  ShieldCheckIcon as ShieldCheck,
} from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { ActivityTrustBadge } from "@/components/ui/activity-trust-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, getInitials } from "@/lib/utils";

export type ActivityFeedEventView = {
  id: string;
  source: string;
  type: string;
  actor: string;
  idempotencyKey: string;
  timestamp: string;
  payload: unknown;
  provenance: {
    signatureVerified: true;
    publicKey: string;
    signingIdentityStatus: "active" | "retired";
    sourceDisplayName: string;
    integration: "github" | null;
    trustStatus: "standard" | "trusted";
    scoreMultiplier: number;
    payloadClaimsVerified: false;
  };
};

export type ActivityFeedFilters = {
  source?: string;
  type?: string;
  actor?: string;
};

export type ActivityEndorsementView = {
  totalCount: number;
  endorsedByCurrentUser: boolean;
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
  endorsements?: Record<string, ActivityEndorsementView>;
  canEndorse?: boolean;
  pendingEndorsementId?: string;
  onApplyFilters: (filters: ActivityFeedFilters) => void;
  onToggleEndorsement?: (eventId: string) => void;
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
  endorsements = {},
  canEndorse = false,
  pendingEndorsementId,
  onApplyFilters,
  onToggleEndorsement,
  onNextPage,
  onPreviousPage,
  onRetry,
}: ActivityFeedProps) {
  const [source, setSource] = useState(filters.source ?? "");
  const [type, setType] = useState(filters.type ?? "");
  const [actor, setActor] = useState(filters.actor ?? "");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Activity feed</h1>
        {liveStatus && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                liveStatus === "live"
                  ? "bg-brand-accent"
                  : liveStatus === "connecting"
                    ? "animate-pulse bg-muted-foreground"
                    : "bg-muted-foreground",
              )}
            />
            {liveStatus}
          </span>
        )}
      </header>

      <form
        className="grid grid-cols-1 gap-3 border-b pb-5 sm:grid-cols-3"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          onApplyFilters({
            source: source.trim() || undefined,
            type: type.trim() || undefined,
            actor: actor.trim() || undefined,
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="activity-source-filter">Activity Source</Label>
          <Input
            id="activity-source-filter"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="feedback-rounds"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-type-filter">Event type</Label>
          <Input
            id="activity-type-filter"
            value={type}
            onChange={(event) => setType(event.target.value)}
            placeholder="feedback.submitted"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-actor-filter">NEAR actor</Label>
          <Input
            id="activity-actor-filter"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            placeholder="alice.near"
          />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
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

      {status === "loading" ? (
        <div role="status" aria-live="polite" className="space-y-6 py-2">
          <span className="sr-only">Loading Activity events…</span>
          {[0, 1, 2].map((i) => (
            <Card key={i} className="gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3.5 w-3/4" />
            </Card>
          ))}
        </div>
      ) : status === "error" ? (
        <div role="alert" className="py-8 text-sm">
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
        </div>
      ) : (
        <div className="space-y-4">
          {skippedInvalid > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 text-xs text-muted-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {skippedInvalid} invalid relay {skippedInvalid === 1 ? "event was" : "events were"}{" "}
                omitted.
              </span>
            </div>
          )}

          {events.length === 0 ? (
            <div role="status" className="py-8 text-sm">
              <p className="font-semibold text-foreground">No Activity events found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try clearing or changing the current filters.
              </p>
            </div>
          ) : (
            <ol className="space-y-4" aria-label="Activity events">
              {events.map((event) => {
                const endorsement = endorsements[event.id] ?? {
                  totalCount: 0,
                  endorsedByCurrentUser: false,
                };
                return (
                  <li key={event.id}>
                    <Card className="gap-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <Avatar className="mt-0.5">
                            <AvatarFallback>{getInitials(event.actor)}</AvatarFallback>
                          </Avatar>
                          <div className="space-y-1">
                            <p className="font-semibold text-foreground">{event.actor}</p>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="font-mono">{event.type}</span>
                              <span>{event.provenance.sourceDisplayName}</span>
                              <span className="font-mono">{event.source}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <Badge variant="secondary">
                                <ShieldCheck />
                                Verified signature
                              </Badge>
                              <ActivityTrustBadge
                                trustStatus={event.provenance.trustStatus}
                                scoreMultiplier={event.provenance.scoreMultiplier}
                              />
                              {event.provenance.integration === "github" &&
                                event.type.startsWith("github.") && (
                                  <Badge variant="outline">
                                    <GitPullRequest />
                                    GitHub
                                  </Badge>
                                )}
                              {event.provenance.signingIdentityStatus === "retired" && (
                                <Badge variant="outline">Historical signing key</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <time
                          dateTime={event.timestamp}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(event.timestamp).toLocaleString("en-US", { timeZone: "UTC" })}{" "}
                          UTC
                        </time>
                      </div>
                      <p className="text-sm leading-relaxed">
                        {eventSummary(event.payload, event.type)}
                      </p>
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">
                          Event details
                        </summary>
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                          {payloadSummary(event.payload)}
                        </pre>
                        <p className="mt-2">
                          The signature matches this Activity Source&apos;s registered key. Payload
                          claims are not independently verified.
                        </p>
                      </details>
                      <div className="flex items-center gap-2 border-t pt-3">
                        <Button
                          type="button"
                          size="sm"
                          variant={endorsement.endorsedByCurrentUser ? "secondary" : "ghost"}
                          aria-pressed={endorsement.endorsedByCurrentUser}
                          disabled={!canEndorse || pendingEndorsementId === event.id}
                          title={canEndorse ? undefined : "Sign in to endorse Activity events"}
                          onClick={() => onToggleEndorsement?.(event.id)}
                        >
                          <Heart />
                          {pendingEndorsementId === event.id
                            ? "Updating…"
                            : endorsement.endorsedByCurrentUser
                              ? "Endorsed"
                              : "Endorse"}
                        </Button>
                        <span className="text-sm text-muted-foreground" aria-live="polite">
                          {endorsement.totalCount}{" "}
                          {endorsement.totalCount === 1 ? "endorsement" : "endorsements"}
                        </span>
                      </div>
                    </Card>
                  </li>
                );
              })}
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

function eventSummary(payload: unknown, type: string): string {
  if (payload && typeof payload === "object") {
    for (const key of ["title", "summary", "description"]) {
      if (key in payload) {
        const value = Reflect.get(payload, key);
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }
  return type.replace(/[._]/g, " ");
}
