import {
  ArrowRightIcon as ArrowRight,
  BookOpenIcon as BookOpen,
  CheckIcon as Check,
  CopyIcon as Copy,
  GithubLogoIcon as GithubLogo,
  HeartIcon as Heart,
  LinkIcon as LinkSimple,
  PaperPlaneTiltIcon as PaperPlane,
  PencilSimpleLineIcon as PencilSimpleLine,
  PulseIcon as Pulse,
  SealCheckIcon as SealCheck,
  ShieldCheckIcon as ShieldCheck,
} from "@phosphor-icons/react/ssr";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { type ApiClient, sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import type { ActivityFeedEventView } from "@/components/activity-feed";
import { ActivityTimestamp } from "@/components/activity-timestamp";
import { BrandElement } from "@/components/brand-element";
import { LandingWhyActivity } from "@/components/landing-why-activity";
import { ActivityRankBadge } from "@/components/ui/activity-leaderboard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Marquee } from "@/components/ui/marquee";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mergeLiveActivityEvent } from "@/hooks/use-activity-feed";
import { useLiveActivityEvents } from "@/hooks/use-live-activity-events";
import { activityFeedOptions, activityLeaderboardOptions } from "@/lib/activity-queries";
import { cn, getInitials } from "@/lib/utils";

const REPOSITORY_URL = "https://github.com/NEARBuilders/activity.nearbuilders.org";
const API_BASE = "https://activity.nearbuilders.org/api";

const CODE_SAMPLES = [
  {
    value: "curl",
    label: "Send · curl",
    code: `curl -X POST ${API_BASE}/v1/events \\
  -H "Authorization: Bearer $ACTIVITY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "eventType": "feedback.submitted",
    "actor": "alice.near",
    "idempotencyKey": "feedback:42",
    "payload": { "title": "Reviewed the onboarding flow" }
  }'`,
  },
  {
    value: "javascript",
    label: "Send · JavaScript",
    code: `await fetch("${API_BASE}/v1/events", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.ACTIVITY_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    eventType: "feedback.submitted",
    actor: "alice.near",
    idempotencyKey: "feedback:42",
    payload: { title: "Reviewed the onboarding flow" },
  }),
});`,
  },
  {
    value: "read",
    label: "Read reputation",
    code: `curl "${API_BASE}/v1/leaderboard?period=all-time&limit=10"

{
  "data": [
    {
      "rank": 1,
      "actor": "alice.near",
      "score": 135,
      "eventCount": 7,
      "breakdown": [ … per source and event type … ]
    }
  ]
}`,
  },
] as const;

type ActivityEvent = ActivityFeedEventView;

function allTimeLeaderboardOptions(api: Pick<ApiClient, "getActivityLeaderboard">) {
  return queryOptions({
    queryKey: ["activity-leaderboard", "all-time", "landing"],
    queryFn: () => api.getActivityLeaderboard({ period: "all-time", limit: 100 }),
    staleTime: 60_000,
    retry: 1,
  });
}

export const Route = createFileRoute("/_layout/")({
  head: () => ({
    meta: [
      { title: "NEAR Builders Activity" },
      {
        name: "description",
        content:
          "A shared activity layer for every project on NEAR. Publish signed records of what your users do, and their history follows them to every app.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(activityFeedOptions(context.apiClient, {})),
      context.queryClient.prefetchQuery(activityLeaderboardOptions(context.apiClient, {})),
      context.queryClient.prefetchQuery(allTimeLeaderboardOptions(context.apiClient)),
    ]);
  },
  component: LandingPage,
});

function LandingPage() {
  const auth = useAuthClient();
  const api = useApiClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const isSignedIn = Boolean(session?.user);
  const feed = useQuery(activityFeedOptions(api, {}));
  const weekly = useQuery(activityLeaderboardOptions(api, {}));
  const allTime = useQuery(allTimeLeaderboardOptions(api));
  const live = useLiveActivityEvents();
  const events = live.events.reduceRight<ActivityEvent[]>(
    (current, event) => mergeLiveActivityEvent(current, event),
    feed.data?.data ?? [],
  );
  const liveIds = new Set(live.events.map(({ id }) => id));

  return (
    <div>
      <Band
        className="relative overflow-hidden"
        innerClassName="relative space-y-14 pt-10 pb-16 sm:space-y-20 sm:pt-16 sm:pb-20"
      >
        <HeroBackdrop />
        <Hero
          isSignedIn={isSignedIn}
          events={events}
          liveIds={liveIds}
          isLoading={feed.isPending}
        />
        <ProofStrip allTime={allTime.data?.data} />
      </Band>
      <Band tone="lifted">
        <LandingWhyActivity />
      </Band>
      <Band>
        <LiveNow
          events={events}
          liveIds={liveIds}
          isLive={live.isLive}
          isLoading={feed.isPending}
          weekly={weekly.data?.data}
          allTime={allTime.data?.data}
          isLeaderboardLoading={weekly.isPending || allTime.isPending}
        />
      </Band>
      <Band tone="lifted">
        <ForProjects isSignedIn={isSignedIn} />
      </Band>
      <Band>
        <FinalCta isSignedIn={isSignedIn} />
      </Band>
      <Band className="border-t border-border" innerClassName="py-8">
        <Footer />
      </Band>
    </div>
  );
}

function Band({
  tone = "base",
  className,
  innerClassName,
  children,
}: {
  tone?: "base" | "lifted";
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("w-full", tone === "lifted" && "border-y border-border bg-muted/70", className)}
    >
      <div
        className={cn(
          "mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function HeroBackdrop() {
  const signals = [
    { top: "18%", duration: "7s", delay: "0s" },
    { top: "38%", duration: "9s", delay: "2.5s" },
    { top: "58%", duration: "6.5s", delay: "1.2s" },
    { top: "78%", duration: "8s", delay: "4s" },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="landing-grid absolute inset-0" />
      <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_70%_45%,black,transparent)]">
        {signals.map((signal) => (
          <span
            key={signal.top}
            className="landing-signal"
            style={
              {
                top: signal.top,
                "--signal-duration": signal.duration,
                "--signal-delay": signal.delay,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="landing-glow absolute top-1/2 right-[-10%] hidden size-[36rem] -translate-y-1/2 rounded-full lg:block" />
    </div>
  );
}

function Hero({
  isSignedIn,
  events,
  liveIds,
  isLoading,
}: {
  isSignedIn: boolean;
  events: ActivityEvent[];
  liveIds: Set<string>;
  isLoading: boolean;
}) {
  return (
    <section className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-accent" />
          Open activity layer for the NEAR ecosystem
        </p>
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
            Activity that follows your users across{" "}
            <span className="text-brand-accent-strong">NEAR</span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Publish signed records of what your users do in your app. Each record is credited to
            their NEAR account, so their history goes with them to every app on NEAR that reads it.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link to="/activity">
              <Pulse />
              Explore activity
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <Link to={isSignedIn ? "/home" : "/activity-sources"}>
              {isSignedIn ? "Open your overview" : "Add your project"}
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <SealCheck className="size-4 text-brand-accent" weight="fill" />
            Every event signed
          </li>
          <li className="flex items-center gap-1.5">
            <LinkSimple className="size-4 text-brand-accent" />
            Linked to NEAR accounts
          </li>
        </ul>
      </div>
      <HeroEventStack events={events} liveIds={liveIds} isLoading={isLoading} />
    </section>
  );
}

function HeroEventStack({
  events,
  liveIds,
  isLoading,
}: {
  events: ActivityEvent[];
  liveIds: Set<string>;
  isLoading: boolean;
}) {
  const [featured, ...rest] = events;
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div
        aria-hidden="true"
        className="absolute inset-x-6 -bottom-4 hidden h-full rounded-xl border border-border bg-card/60 sm:block"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-3 -bottom-2 hidden h-full rounded-xl border border-border bg-card/80 sm:block"
      />
      <Card
        key={featured?.id ?? "empty"}
        className={cn(
          "relative gap-4 p-5 shadow-elevation-md",
          featured && liveIds.has(featured.id) && "animate-landing-event-arrive",
        )}
      >
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : featured ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-brand-accent"
                />
                Latest event
              </span>
              <ActivityTimestamp value={featured.timestamp} />
            </div>
            <div className="flex items-center gap-3">
              <Avatar className="size-10">
                <AvatarFallback className="text-xs">{getInitials(featured.actor)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{featured.actor}</p>
                <p className="truncate text-xs text-muted-foreground">
                  via {featured.provenance.sourceDisplayName}
                </p>
              </div>
            </div>
            <p className="text-sm text-foreground">{eventTitle(featured.payload, featured.type)}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-mono font-normal">
                {featured.type}
              </Badge>
              <Badge variant="outline" className="border-brand-accent/40 bg-brand-accent/10">
                <ShieldCheck />
                Signature verified
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
              <span className="truncate">id {shortId(featured.id)}</span>
              <span className="shrink-0">key {shortId(featured.provenance.publicKey)}</span>
            </div>
            {rest.length > 0 && (
              <p className="text-xs text-muted-foreground">
                and {rest.length} more in the{" "}
                <Link to="/activity" className="underline underline-offset-2 hover:text-foreground">
                  live feed
                </Link>
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No events yet. The first project to publish will appear here.
          </p>
        )}
      </Card>
    </div>
  );
}

type LeaderboardEntry = Awaited<ReturnType<ApiClient["getActivityLeaderboard"]>>["data"][number];

function ProofStrip({ allTime }: { allTime?: LeaderboardEntry[] }) {
  const accounts = allTime?.length ?? 0;
  const truncated = accounts >= 100;
  const eventsCredited = (allTime ?? []).reduce((sum, entry) => sum + entry.eventCount, 0);
  const stats: Array<{ label: string; value?: number; suffix?: string; text?: string }> = [
    { label: "accounts credited", value: accounts, suffix: truncated ? "+" : "" },
    { label: "events on the leaderboard", value: eventsCredited, suffix: truncated ? "+" : "" },
    { label: "of events signed at the source", value: 100, suffix: "%" },
    { label: "updates as events land", text: "Live" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="space-y-1 bg-background px-5 py-4">
          <dt className="sr-only">{stat.label}</dt>
          <dd className="text-2xl font-semibold tracking-tight text-foreground">
            {stat.text ?? (
              <>
                <NumberTicker value={stat.value ?? 0} />
                {stat.suffix}
              </>
            )}
          </dd>
          <dd className="text-xs text-muted-foreground">{stat.label}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveNow({
  events,
  liveIds,
  isLive,
  isLoading,
  weekly,
  allTime,
  isLeaderboardLoading,
}: {
  events: ActivityEvent[];
  liveIds: Set<string>;
  isLive: boolean;
  isLoading: boolean;
  weekly?: LeaderboardEntry[];
  allTime?: LeaderboardEntry[];
  isLeaderboardLoading: boolean;
}) {
  const weeklyScored = (weekly ?? []).filter(({ score }) => score > 0);
  const useWeekly = weeklyScored.length >= 3;
  const ranking = (
    useWeekly ? weeklyScored : (allTime ?? []).filter(({ score }) => score > 0)
  ).slice(0, 6);
  const sourceCounts = new Map<string, number>();
  for (const event of events) {
    const name = event.provenance.sourceDisplayName;
    sourceCounts.set(name, (sourceCounts.get(name) ?? 0) + 1);
  }
  const sources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

  return (
    <section className="space-y-6" aria-labelledby="live-now">
      <SectionHeading
        id="live-now"
        eyebrow="Live now"
        title="What's happening on Activity"
        description="Events land here the moment a project publishes them. Anyone can read them, no account needed."
        action={
          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
            <Link to="/activity">
              Open the full feed
              <ArrowRight />
            </Link>
          </Button>
        }
      />
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-medium">Latest events</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  isLive ? "animate-pulse bg-brand-accent" : "bg-muted-foreground",
                )}
              />
              {isLive ? "Live" : "Recent"}
            </span>
          </div>
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : events.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              No events yet. The first project to publish will appear here.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {events.slice(0, 6).map((event) => (
                <li
                  key={event.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3",
                    liveIds.has(event.id) && "animate-landing-event-arrive",
                  )}
                >
                  <Avatar className="size-8">
                    <AvatarFallback className="text-[10px]">
                      {getInitials(event.actor)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium text-foreground">{event.actor}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {eventTitle(event.payload, event.type)}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{event.type}</span>
                      <span aria-hidden="true"> · </span>
                      {event.provenance.sourceDisplayName}
                    </p>
                  </div>
                  <ActivityTimestamp value={event.timestamp} className="shrink-0" />
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-medium">Top accounts</span>
            <span className="text-xs text-muted-foreground">
              {useWeekly ? "This week" : "All time"}
            </span>
          </div>
          {isLeaderboardLoading ? (
            <ListSkeleton rows={5} />
          ) : ranking.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">No scores yet.</p>
          ) : (
            <ol className="flex-1 divide-y divide-border">
              {ranking.map((entry) => (
                <li key={entry.actor} className="flex items-center gap-3 px-4 py-3">
                  <ActivityRankBadge rank={entry.rank} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{entry.actor}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.eventCount} {entry.eventCount === 1 ? "event" : "events"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {entry.score}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Link
            to="/activity"
            className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-3 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            See the full leaderboard <ArrowRight aria-hidden="true" />
          </Link>
        </Card>
      </div>

      {sources.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
          <span className="shrink-0 text-sm text-muted-foreground">Publishing recently</span>
          <div className="min-w-0 flex-1">
            {sources.length > 3 ? (
              <Marquee
                pauseOnHover
                repeat={3}
                className="p-0 [--duration:30s] [--gap:0.5rem] [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
              >
                {sources.map((source) => (
                  <Badge key={source} variant="secondary" className="whitespace-nowrap">
                    {source}
                  </Badge>
                ))}
              </Marquee>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <Badge key={source} variant="secondary">
                    {source}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Button asChild size="sm" variant="outline" className="w-full shrink-0 sm:w-auto">
            <Link to="/activity-sources">
              Your project could be next
              <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function ForProjects({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section className="space-y-10" aria-labelledby="for-projects">
      <SectionHeading
        id="for-projects"
        eyebrow="For projects and apps"
        title="Publish in three steps. Read it back in one."
        description="Projects send one HTTP request per event. Apps read scores and history with a single public call, no key needed."
      />
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-6">
          <ol className="relative space-y-6 before:absolute before:top-3.5 before:bottom-3.5 before:left-[13px] before:w-px before:bg-border">
            <Step
              number={1}
              icon={<PencilSimpleLine />}
              title="Register your project"
              body="Pick a Source ID and declare the kinds of events you'll send, each with a point value. An admin reviews it."
              meta="A few minutes"
            />
            <Step
              number={2}
              icon={<LinkSimple />}
              title="Link it on-chain"
              body="Approve one transaction from your project's NEAR account. It proves the project owns its signing key."
              meta="One wallet approval · about 0.0001 NEAR"
            />
            <Step
              number={3}
              icon={<PaperPlane />}
              title="Send events"
              body="Post events from your server with your API key. They're credited to each NEAR account and show up everywhere at once."
              meta="One request per event · safe to retry"
            />
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="w-full sm:w-auto">
              <Link to="/activity-sources">
                {isSignedIn ? "Manage your sources" : "Add your project"}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/docs/$slug" params={{ slug: "integration-guide" }}>
                <BookOpen />
                Read the integration guide
              </Link>
            </Button>
          </div>
        </div>
        <CodePanel />
      </div>
    </section>
  );
}

function FinalCta({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-12 text-center sm:px-12 sm:py-16">
      <div
        aria-hidden="true"
        className="landing-glow pointer-events-none absolute -top-40 left-1/2 size-[32rem] -translate-x-1/2 rounded-full"
      />
      <div className="relative mx-auto max-w-xl space-y-5">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
          Give your users credit that lasts
        </h2>
        <p className="text-sm text-muted-foreground sm:text-base">
          Register your project, link it once, and every event you send becomes part of a shared,
          verifiable history on NEAR.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link to="/activity-sources">
              {isSignedIn ? "Manage your sources" : "Add your project"}
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <Link to="/activity">
              <Pulse />
              Explore activity
            </Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Free to use · about 0.0001 NEAR once to link · reviewed by an admin
        </p>
      </div>
    </section>
  );
}

function CodePanel() {
  const [active, setActive] = useState<string>(CODE_SAMPLES[0].value);
  const [copied, setCopied] = useState(false);
  const current = CODE_SAMPLES.find((sample) => sample.value === active) ?? CODE_SAMPLES[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the code and copy it manually.");
    }
  };

  return (
    <div className="min-w-0 space-y-2">
      <Tabs
        value={active}
        onValueChange={setActive}
        className="gap-0 overflow-hidden rounded-xl border border-border bg-muted"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border pr-1.5 pl-2">
          <TabsList variant="line" className="h-10">
            {CODE_SAMPLES.map((sample) => (
              <TabsTrigger key={sample.value} value={sample.value} className="flex-none text-xs">
                {sample.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button type="button" size="xs" variant="ghost" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {CODE_SAMPLES.map((sample) => (
          <TabsContent key={sample.value} value={sample.value}>
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
              <code>{sample.code}</code>
            </pre>
          </TabsContent>
        ))}
      </Tabs>
      <p className="text-xs text-muted-foreground">
        {active === "read" ? (
          "Reads are public. Filter the feed by actor, source or type, or subscribe to the live stream."
        ) : (
          <>
            Sending the same <code className="font-mono">idempotencyKey</code> again returns the
            same event ID, so retries never create duplicates.
          </>
        )}
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <a
          href="https://nearbuilders.org"
          target="_blank"
          rel="noreferrer"
          aria-label="NearBuilders"
          className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandElement appName="NEAR Builders" size="sm" />
        </a>
        <p className="inline-flex items-center gap-1.5">
          Made with
          <Heart weight="fill" className="size-4 text-brand-accent" aria-label="love" />
          by{" "}
          <a
            href="https://nearbuilders.org"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground hover:underline"
          >
            NearBuilders
          </a>
        </p>
      </div>
      <nav aria-label="Resources" className="flex flex-wrap gap-x-5 gap-y-2">
        <Link to="/docs" className="hover:text-foreground">
          Docs
        </Link>
        <Link
          to="/docs/$slug"
          params={{ slug: "activity-protocol" }}
          className="hover:text-foreground"
        >
          Event protocol
        </Link>
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-foreground"
        >
          <GithubLogo aria-hidden="true" />
          GitHub
        </a>
      </nav>
    </footer>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl space-y-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <h2 id={id} className="text-2xl font-semibold tracking-tight text-balance text-foreground">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground sm:text-base">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Step({
  number,
  icon,
  title,
  body,
  meta,
}: {
  number: number;
  icon: ReactNode;
  title: string;
  body: string;
  meta: string;
}) {
  return (
    <li className="relative flex gap-4">
      <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-accent text-xs font-semibold text-brand-accent-foreground">
        {number}
      </span>
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        </div>
        <p className="text-sm text-muted-foreground">{body}</p>
        <p className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {meta}
        </p>
      </div>
    </li>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 px-4 py-4">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

function eventTitle(payload: unknown, type: string): string {
  if (payload && typeof payload === "object") {
    for (const key of ["title", "summary", "projectTitle", "description"]) {
      const value = Reflect.get(payload, key);
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  const words = type.replace(/[._]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
