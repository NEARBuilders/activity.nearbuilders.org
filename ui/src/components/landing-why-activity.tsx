import {
  AppWindowIcon as AppWindow,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  GitMergeIcon as GitMerge,
  HeartIcon as Heart,
  PaperPlaneTiltIcon as PaperPlane,
  PulseIcon as Pulse,
  RowsIcon as Rows,
  TrophyIcon as Trophy,
} from "@phosphor-icons/react/ssr";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { AnimatedListItem } from "@/components/ui/animated-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BorderBeam } from "@/components/ui/border-beam";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn, getInitials } from "@/lib/utils";

const TICK_MS = 2400;
const MAX_BUMPS = 8;

const EXAMPLE_ACCOUNT = "maya.near";

const EXAMPLE_HISTORY = [
  {
    source: "NEAR Builders",
    type: "project.approved",
    points: 25,
    events: 2,
    shade: "bg-brand-accent",
  },
  {
    source: "GitHub",
    type: "github.pr.merged",
    points: 10,
    events: 3,
    shade: "bg-brand-accent/70",
  },
  {
    source: "NEAR Catalog",
    type: "nearcatalog.claim",
    points: 15,
    events: 1,
    shade: "bg-brand-accent/45",
  },
  {
    source: "Feedback rounds",
    type: "feedback.submitted",
    points: 5,
    events: 2,
    shade: "bg-brand-accent/25",
  },
];

const RECENT_LABELS = ["just now", "a minute ago", "earlier today"];

const GITHUB_EXAMPLES = [
  { kind: "pr", label: "PR #128 merged", repo: "nearbuilders/activity", points: 10 },
  { kind: "issue", label: "Issue #47 closed", repo: "near/near-cli-rs", points: 5 },
  { kind: "pr", label: "PR #312 merged", repo: "near/wallet-selector", points: 10 },
  { kind: "pr", label: "PR #89 merged", repo: "nearbuilders/nearbuilders.org", points: 10 },
  { kind: "issue", label: "Issue #203 closed", repo: "near/near-api-js", points: 5 },
  { kind: "pr", label: "PR #56 merged", repo: "nearbuilders/feedback", points: 10 },
] as const;

const ENDORSERS = ["lior.near", "ana.near", "kofi.near", "jun.near", "ade.near"];

const SIGNING_STEPS = [
  { label: "Received", caption: "POST /v1/events with the project's API key" },
  { label: "Signed", caption: "Signed with the project's own Nostr key" },
  { label: "Verified", caption: "Checked against the key linked on-chain" },
];

function useTicker(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return tick;
}

export function LandingWhyActivity() {
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef);
  const reducedMotion = useReducedMotion();
  const animate = inView && !reducedMotion;
  const tick = useTicker(animate);

  return (
    <section ref={sectionRef} className="space-y-10" aria-labelledby="why-activity">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Why Activity
        </p>
        <h2
          id="why-activity"
          className="text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl"
        >
          Reputation shouldn't reset in every app
        </h2>
        <p className="text-sm text-muted-foreground sm:text-base">
          Today each NEAR app keeps its own record of who did what. Activity gives every project one
          place to publish it, and every user one history that travels with their NEAR account.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-6">
        <BentoTile
          className="md:col-span-3 md:row-span-2"
          beam
          title="One history per NEAR account"
          body="Events from every project add up under the same account, with a breakdown anyone can inspect."
          visual={<HistoryVisual animate={animate} tick={tick} />}
        />
        <BentoTile
          className="md:col-span-3"
          title="Signed where it happened"
          body="The signature shows which project published an event. Activity doesn't vouch for what the event claims."
          visual={
            <SigningVisual
              step={animate ? tick % (SIGNING_STEPS.length + 1) : SIGNING_STEPS.length}
            />
          }
        />
        <BentoTile
          className="md:col-span-3"
          title="Live everywhere"
          body="New events stream to the feed, leaderboards and any app that subscribes, with resumable connections."
          visual={<LiveVisual />}
        />
        <BentoTile
          className="md:col-span-2"
          title="Scores you can tune"
          body="Change a point value and the whole history re-ranks on the next read."
          visual={<ScoringVisual raised={animate && Math.floor(tick / 2) % 2 === 1} />}
        />
        <BentoTile
          className="md:col-span-2"
          title="Endorsed by people"
          body="People endorse activity they've seen, so you can tell what others back."
          visual={
            <EndorseVisual
              endorsers={animate ? 1 + (tick % ENDORSERS.length) : 3}
              animate={animate}
            />
          }
        />
        <BentoTile
          className="md:col-span-2"
          title="Works without a server"
          body="Activity can poll public GitHub repos and credit merged PRs and closed issues."
          visual={<GithubVisual count={animate ? tick + 3 : 3} />}
        />
      </div>
    </section>
  );
}

function BentoTile({
  className,
  beam = false,
  title,
  body,
  visual,
}: {
  className?: string;
  beam?: boolean;
  title: string;
  body: string;
  visual: ReactNode;
}) {
  return (
    <article
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      {beam && <BorderBeam size={160} duration={10} borderWidth={1.5} />}
      <div className="relative flex min-h-48 flex-1 items-center justify-center overflow-hidden border-b border-border bg-muted/30 px-5 py-6">
        <div aria-hidden="true" className="bento-dots absolute inset-0" />
        <div className="relative flex w-full justify-center">{visual}</div>
      </div>
      <div className="space-y-1 px-5 py-4">
        <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </article>
  );
}

function HistoryVisual({ animate, tick }: { animate: boolean; tick: number }) {
  const bumps = animate ? Math.min(tick, MAX_BUMPS) : 0;
  const rows = EXAMPLE_HISTORY.map((row, index) => {
    let extra = 0;
    for (let bump = 1; bump <= bumps; bump += 1) {
      if ((bump - 1) % EXAMPLE_HISTORY.length === index) extra += 1;
    }
    const events = row.events + extra;
    return { ...row, events, score: events * row.points };
  });
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  const eventCount = rows.reduce((sum, row) => sum + row.events, 0);
  const recent =
    bumps > 0
      ? Array.from({ length: Math.min(bumps, 3) }, (_, position) => ({
          id: bumps - position,
          row: (bumps - position - 1) % EXAMPLE_HISTORY.length,
        }))
      : [
          { id: -1, row: 1 },
          { id: -2, row: 0 },
          { id: -3, row: 3 },
        ];

  return (
    <div className="w-full max-w-md space-y-5">
      <div className="flex items-center gap-3">
        <Avatar className="size-10">
          <AvatarFallback className="bg-background text-xs">
            {getInitials(EXAMPLE_ACCOUNT)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{EXAMPLE_ACCOUNT}</p>
          <p className="text-xs text-muted-foreground">
            {eventCount} events from {rows.length} projects
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold leading-none tracking-tight text-foreground">
            <NumberTicker value={total} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">points</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {rows.map((row) => (
            <div
              key={row.type}
              className={cn("h-full transition-[flex-grow] duration-700 ease-out", row.shade)}
              style={{ flexGrow: row.score }}
            />
          ))}
        </div>
        <ul className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          {rows.map((row) => (
            <li key={row.type} className="flex items-center gap-2">
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", row.shade)} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.source}</span>
              <span className="shrink-0 tabular-nums text-foreground">{row.score}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Latest
        </p>
        <div className="flex h-[7.25rem] flex-col gap-1.5 overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            {recent.map(({ id, row }, position) => {
              const item = EXAMPLE_HISTORY[row];
              return (
                <AnimatedListItem key={id}>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-elevation-sm">
                    <span aria-hidden="true" className={cn("size-1.5 rounded-full", item.shade)} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-foreground">{item.source}</span>
                      <span className="text-muted-foreground"> · </span>
                      <span className="font-mono text-muted-foreground">{item.type}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground">+{item.points}</span>
                    <span className="hidden w-20 shrink-0 text-right text-muted-foreground sm:block">
                      {RECENT_LABELS[position]}
                    </span>
                  </div>
                </AnimatedListItem>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">Example account. Live data is below.</p>
    </div>
  );
}

function SigningVisual({ step }: { step: number }) {
  const completed = step >= SIGNING_STEPS.length;
  const progress = Math.min(step, SIGNING_STEPS.length - 1) / (SIGNING_STEPS.length - 1);
  const caption = completed
    ? "Anyone can verify who published it"
    : (SIGNING_STEPS[step]?.caption ?? "");

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5">
      <ol className="relative grid w-full grid-cols-3">
        <span
          aria-hidden="true"
          className="absolute top-4 right-[16.66%] left-[16.66%] h-px bg-border"
        />
        <span
          aria-hidden="true"
          className="absolute top-4 left-[16.66%] h-px bg-brand-accent transition-[width] duration-700 ease-out"
          style={{ width: `${progress * 66.66}%` }}
        />
        {SIGNING_STEPS.map((item, index) => {
          const done = index < step || completed;
          const current = index === step && !completed;
          return (
            <li key={item.label} className="relative flex flex-col items-center gap-2">
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-500",
                  done && "border-brand-accent bg-brand-accent text-brand-accent-foreground",
                  current &&
                    "border-brand-accent bg-card text-foreground ring-4 ring-brand-accent/15",
                  !done && !current && "border-border bg-card text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" weight="bold" /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-xs transition-colors duration-500",
                  done || current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>
      <span
        key={caption}
        className="animate-fade-in rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground shadow-elevation-sm"
      >
        {caption}
      </span>
    </div>
  );
}

function LiveVisual() {
  const containerRef = useRef<HTMLDivElement>(null);
  const eventRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const outputs = [
    { ref: feedRef, curvature: 24, delay: 0.6 },
    { ref: boardRef, curvature: 0, delay: 0.9 },
    { ref: appRef, curvature: -24, delay: 1.2 },
  ];

  return (
    <div
      ref={containerRef}
      className="relative flex h-36 w-full max-w-sm items-center justify-between"
    >
      <NodePill nodeRef={eventRef} icon={<PaperPlane />} label="Event" />
      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <div
          ref={hubRef}
          className="flex size-12 items-center justify-center rounded-full border border-brand-accent/50 bg-card text-brand-accent-strong shadow-elevation-sm ring-4 ring-brand-accent/10 [&_svg]:size-5"
        >
          <Pulse weight="bold" />
        </div>
        <span className="text-[11px] font-medium text-foreground">Activity</span>
      </div>
      <div className="flex flex-col items-start gap-3">
        <NodePill nodeRef={feedRef} icon={<Rows />} label="Feed" />
        <NodePill nodeRef={boardRef} icon={<Trophy />} label="Leaderboard" />
        <NodePill nodeRef={appRef} icon={<AppWindow />} label="Your app" />
      </div>
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={eventRef}
        toRef={hubRef}
        pathColor="var(--border)"
        pathOpacity={1}
        pathWidth={1.5}
        duration={3}
      />
      {outputs.map((output) => (
        <AnimatedBeam
          key={output.delay}
          containerRef={containerRef}
          fromRef={hubRef}
          toRef={output.ref}
          curvature={output.curvature}
          pathColor="var(--border)"
          pathOpacity={1}
          pathWidth={1.5}
          duration={3}
          delay={output.delay}
        />
      ))}
    </div>
  );
}

function NodePill({
  nodeRef,
  icon,
  label,
}: {
  nodeRef: Ref<HTMLDivElement>;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div
      ref={nodeRef}
      className="relative z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground shadow-elevation-sm [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
    >
      {icon}
      {label}
    </div>
  );
}

function ScoringVisual({ raised }: { raised: boolean }) {
  const points = raised ? 30 : 25;
  const rows = [
    { actor: "maya.near", detail: `2 × ${points}`, score: points * 2 },
    { actor: "lior.near", detail: "5 × 11", score: 55 },
  ].sort((a, b) => b.score - a.score);

  return (
    <div className="w-full max-w-[15rem] space-y-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono text-muted-foreground">project.approved</span>
        <span
          key={points}
          className={cn(
            "rounded-full border px-2 py-0.5 tabular-nums",
            raised
              ? "landing-pop border-brand-accent/50 bg-brand-accent/10 text-foreground"
              : "border-border bg-card text-muted-foreground",
          )}
        >
          {points} pts
        </span>
      </div>
      <ol className="space-y-1.5">
        {rows.map((row, index) => (
          <motion.li
            key={row.actor}
            layout
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
            className="flex items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 text-xs shadow-elevation-sm"
          >
            <span className="w-3 text-muted-foreground tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{row.actor}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{row.detail}</span>
            <span className="w-6 text-right font-semibold tabular-nums text-foreground">
              {row.score}
            </span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

function EndorseVisual({ endorsers, animate }: { endorsers: number; animate: boolean }) {
  const shown = ENDORSERS.slice(0, endorsers);
  return (
    <div className="w-full max-w-[15rem] space-y-3 rounded-lg border border-border bg-card p-3 shadow-elevation-sm">
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-foreground">AgentMarket approved</p>
        <p className="font-mono text-[10px] text-muted-foreground">maya.near · project.approved</p>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {shown.map((account, index) => (
            <Avatar
              key={account}
              className={cn(
                "size-6 ring-2 ring-card",
                animate && index === shown.length - 1 && "landing-pop",
              )}
            >
              <AvatarFallback className="bg-muted text-[9px] font-medium text-foreground">
                {getInitials(account)}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-brand-accent/50 bg-brand-accent/10 px-2 py-0.5 text-[11px] text-foreground">
          <Heart
            key={endorsers}
            weight="fill"
            className={cn("size-3 text-brand-accent-strong", animate && "landing-pop")}
          />
          <span className="tabular-nums">{10 + endorsers}</span>
        </span>
      </div>
    </div>
  );
}

function GithubVisual({ count }: { count: number }) {
  const items = Array.from({ length: Math.min(count, 3) }, (_, position) => {
    const sequence = count - 1 - position;
    return { sequence, position, ...GITHUB_EXAMPLES[sequence % GITHUB_EXAMPLES.length] };
  });

  return (
    <div className="flex h-[8.5rem] w-full max-w-[16rem] flex-col gap-1.5 overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item) => (
          <AnimatedListItem key={item.sequence}>
            <div
              className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 shadow-elevation-sm transition-opacity duration-500"
              style={{ opacity: 1 - item.position * 0.3 }}
            >
              {item.kind === "pr" ? (
                <GitMerge className="size-3.5 shrink-0 text-brand-accent-strong" />
              ) : (
                <CheckCircle className="size-3.5 shrink-0 text-brand-accent-strong" />
              )}
              <div className="min-w-0 flex-1 text-[11px] leading-tight">
                <p className="truncate text-foreground">{item.label}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{item.repo}</p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-foreground">
                +{item.points}
              </span>
            </div>
          </AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
}
