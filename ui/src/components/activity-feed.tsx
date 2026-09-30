import {
  WarningIcon as AlertTriangle,
  BroadcastIcon as Broadcast,
  CaretDownIcon as CaretDown,
  GitPullRequestIcon as GitPullRequest,
  HeartIcon as Heart,
  MagnifyingGlassIcon as MagnifyingGlass,
  ShieldCheckIcon as ShieldCheck,
  TagIcon as Tag,
  UserIcon as User,
  XIcon as X,
} from "@phosphor-icons/react/ssr";
import { type ReactNode, useState } from "react";
import { ActivityTimestamp } from "@/components/activity-timestamp";
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
  const setters = { source: setSource, type: setType, actor: setActor };
  const activeFilters = (
    Object.entries(filters) as Array<[keyof ActivityFeedFilters, string]>
  ).filter(([, value]) => Boolean(value));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Activity feed</h1>
        {liveStatus && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground capitalize"
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

      <div className="space-y-3">
        <form
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 sm:flex-row sm:items-center sm:gap-0"
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            onApplyFilters({
              source: source.trim() || undefined,
              type: type.trim() || undefined,
              actor: actor.trim() || undefined,
            });
          }}
        >
          <FilterField
            id="activity-source-filter"
            label="Activity Source"
            icon={<Broadcast />}
            value={source}
            onChange={setSource}
            placeholder="Source"
          />
          <FilterField
            id="activity-type-filter"
            label="Event type"
            icon={<Tag />}
            value={type}
            onChange={setType}
            placeholder="Event type"
          />
          <FilterField
            id="activity-actor-filter"
            label="NEAR actor"
            icon={<User />}
            value={actor}
            onChange={setActor}
            placeholder="NEAR account"
          />
          <Button type="submit" className="w-full sm:ml-2 sm:w-auto">
            <MagnifyingGlass />
            Apply filters
          </Button>
        </form>
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map(([key, value]) => (
              <Badge key={key} variant="secondary" className="gap-1 pr-1 font-normal">
                <span className="text-muted-foreground">{filterLabels[key]}:</span>
                <span className="font-mono">{value}</span>
                <button
                  type="button"
                  aria-label={`Remove ${filterLabels[key]} filter`}
                  className="rounded-full p-0.5 hover:bg-background"
                  onClick={() => {
                    setters[key]("");
                    onApplyFilters({ ...filters, [key]: undefined });
                  }}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <Button
              type="button"
              size="xs"
              variant="ghost"
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
        )}
      </div>

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
                    <Card className="gap-4 p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback className="text-xs">
                            {getInitials(event.actor)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="truncate font-semibold text-foreground">{event.actor}</p>
                            <ActivityTimestamp value={event.timestamp} className="shrink-0" />
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            via{" "}
                            <span title={event.source}>{event.provenance.sourceDisplayName}</span>
                          </p>
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground">
                        {eventSummary(event.payload, event.type)}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-mono font-normal">
                          {event.type}
                        </Badge>
                        <Badge variant="outline" className="text-muted-foreground">
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
                      <ActivityEventDetails payload={event.payload} />
                      <div className="flex items-center border-t border-border pt-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            endorsement.endorsedByCurrentUser &&
                              "border-brand-accent/50 bg-brand-accent/10 hover:bg-brand-accent/20",
                          )}
                          aria-pressed={endorsement.endorsedByCurrentUser}
                          aria-label={endorsement.endorsedByCurrentUser ? "Endorsed" : "Endorse"}
                          disabled={!canEndorse || pendingEndorsementId === event.id}
                          title={canEndorse ? undefined : "Sign in to endorse Activity events"}
                          onClick={() => onToggleEndorsement?.(event.id)}
                        >
                          <Heart
                            weight={endorsement.endorsedByCurrentUser ? "fill" : "regular"}
                            className={cn(endorsement.endorsedByCurrentUser && "text-brand-accent")}
                          />
                          {pendingEndorsementId === event.id
                            ? "Updating…"
                            : endorsement.endorsedByCurrentUser
                              ? "Endorsed"
                              : "Endorse"}
                          <span aria-hidden="true" className="text-muted-foreground tabular-nums">
                            {endorsement.totalCount}
                          </span>
                        </Button>
                        <span className="sr-only" aria-live="polite">
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

const filterLabels: Record<keyof ActivityFeedFilters, string> = {
  source: "Source",
  type: "Type",
  actor: "Actor",
};

function FilterField({
  id,
  label,
  icon,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 border-b border-border sm:border-r sm:border-b-0">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  );
}

function payloadSummary(payload: unknown): string {
  const summary = JSON.stringify(payload, null, 2) ?? String(payload);
  return summary.length > 2000 ? `${summary.slice(0, 1997)}…` : summary;
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function PayloadValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="break-all underline underline-offset-2 hover:text-foreground"
      >
        {value}
      </a>
    );
  }
  if (typeof value === "object") {
    return <code className="break-all font-mono">{JSON.stringify(value)}</code>;
  }
  return <span className="break-words">{String(value)}</span>;
}

function ActivityEventDetails({ payload }: { payload: unknown }) {
  const entries =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.entries(payload)
      : [];

  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        Event details
        <CaretDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3 text-xs">
        {entries.length > 0 ? (
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr]">
            {entries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{humanizeKey(key)}</dt>
                <dd className="text-foreground">
                  <PayloadValue value={value} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Raw JSON
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono whitespace-pre-wrap break-words text-foreground">
            {payloadSummary(payload)}
          </pre>
        </details>
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          The signature matches this Activity Source&apos;s registered key. Payload claims are not
          independently verified.
        </p>
      </div>
    </details>
  );
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
